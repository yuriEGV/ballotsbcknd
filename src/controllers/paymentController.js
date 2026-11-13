import crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import { computeMerkleRoot, computePadronLeaf } from "../utils/crypto.js";
import web3Service from "../services/web3Service.js";

function getMpClient() {
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
        return null;
    }
    return new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
}

function verifyMercadoPagoSignature(req) {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) return true;

    const xSignature = req.headers["x-signature"];
    const xRequestId = req.headers["x-request-id"];
    if (!xSignature || !xRequestId) return false;

    const parts = {};
    String(xSignature).split(",").forEach((pair) => {
        const [k, v] = pair.split("=").map((s) => s.trim());
        if (k && v) parts[k] = v;
    });

    const dataId = req.query?.["data.id"] || req.body?.data?.id;
    if (!parts.ts || !parts.v1 || !dataId) return false;

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

async function activatePaidElection(election) {
    election.isPaid = true;
    const autoApproved = !election.requiresAdminReview;
    if (autoApproved && election.approvalStatus === "pending") {
        election.approvalStatus = "approved";
        election.approvedBy = election.approvedBy || "auto-self-service";
        election.approvedAt = election.approvedAt || new Date();
    }

    if (election.approvalStatus === "approved") {
        election.status = "active";
        if (web3Service.isWeb3Configured()) {
            try {
                const voters = await Voter.find({ election: election._id }).select("cedula").lean();
                const padronRoot = computeMerkleRoot(
                    voters.map((v) => computePadronLeaf(election._id, v.cedula))
                );
                const reg = await web3Service.ensureElectionRegistered({
                    electionId: election._id,
                    padronRoot,
                    openPadron: Boolean(election.settings?.allowAutoRegistration),
                    startDate: election.startDate,
                    endDate: election.endDate
                });
                election.web3 = {
                    ...(election.web3 || {}),
                    electionKey: reg.electionKey,
                    registered: true,
                    registerTxHash: election.web3?.registerTxHash || reg.txHash || "",
                    padronRoot,
                    contractAddress: reg.contractAddress,
                    chainId: reg.chainId,
                    network: reg.networkName
                };
            } catch (err) {
                console.warn("[Web3] Failed to register election after payment:", err.message);
            }
        }
    }
    await election.save();
    return election;
}

/**
 * Create a payment preference for an election
 */
export const createPayment = async (req, res) => {
    let debugPrice = "N/A";
    try {
        const client = getMpClient();
        if (!client) {
            return res.status(503).json({ success: false, message: "MercadoPago no está configurado." });
        }

        const { electionId } = req.body;
        const election = await Election.findById(electionId);

        if (!election) {
            return res.status(404).json({ success: false, message: "Elección no encontrada" });
        }

        const organizerId = election.organizer?.toString();
        if (req.user.role !== "admin" && organizerId && organizerId !== req.user.id) {
            return res.status(403).json({ success: false, message: "No autorizado para pagar esta elección" });
        }

        debugPrice = election.price;
        const unitPriceNum = Number(election.price);
        if (!Number.isFinite(unitPriceNum) || unitPriceNum <= 0) {
            await activatePaidElection(election);
            return res.json({ success: true, freeActivated: true, data: election });
        }

        const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const backendUrl = process.env.BACKEND_URL || "";

        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [
                    {
                        id: electionId.toString(),
                        title: `Activación: ${election.title.substring(0, 20)}`,
                        unit_price: unitPriceNum,
                        quantity: 1,
                        currency_id: "CLP"
                    }
                ],
                back_urls: {
                    success: `${baseUrl}/dashboard?payment=success`,
                    failure: `${baseUrl}/dashboard?payment=failure`,
                    pending: `${baseUrl}/dashboard?payment=pending`
                },
                ...(backendUrl ? { notification_url: `${backendUrl}/api/payments/webhook` } : {}),
                external_reference: electionId.toString(),
                metadata: {
                    election_id: electionId.toString(),
                    user_id: req.user?.id || "anonymous"
                }
            }
        });

        res.json({ success: true, init_point: result.init_point });
    } catch (error) {
        console.error("MercadoPago Error:", error);
        res.status(500).json({
            success: false,
            error: `Error de Mercado Pago: ${error.message}`,
            debug: { priceInDb: debugPrice }
        });
    }
};

/**
 * Handle Webhook (IPN) from Mercado Pago — verifies actual payment status via MP API
 */
export const handleWebhook = async (req, res) => {
    try {
        if (!verifyMercadoPagoSignature(req)) {
            return res.status(401).json({ success: false, message: "Invalid webhook signature" });
        }

        const type = req.body?.type || req.query?.topic;
        const paymentId = req.body?.data?.id || req.query?.["data.id"] || req.query?.id;

        if (type === "payment" && paymentId) {
            const client = getMpClient();
            if (!client) {
                return res.sendStatus(503);
            }

            const paymentClient = new Payment(client);
            const paymentInfo = await paymentClient.get({ id: paymentId });

            if (paymentInfo.status === "approved") {
                const electionId =
                    paymentInfo.external_reference || paymentInfo.metadata?.election_id;
                if (electionId) {
                    const election = await Election.findById(electionId);
                    if (election && Number(paymentInfo.transaction_amount) >= Number(election.price || 0)) {
                        await activatePaidElection(election);
                        console.log(`[MercadoPago] Election ${electionId} marked as paid via payment ${paymentId}`);
                    }
                }
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook Error:", error);
        res.sendStatus(500);
    }
};

/**
 * Admin: Manually confirm payment
 * POST /api/payments/confirm-manual/:electionId
 */
export const confirmPaymentManual = async (req, res) => {
    try {
        const { electionId } = req.params;
        const election = await Election.findById(electionId);
        if (!election) {
            return res.status(404).json({ success: false, message: "Elección no encontrada" });
        }
        await activatePaidElection(election);
        res.json({ success: true, data: election });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
