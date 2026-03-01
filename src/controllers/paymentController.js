import { MercadoPagoConfig, Preference } from 'mercadopago';
import Election from '../models/Election.js';

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });

/**
 * Create a payment preference for an election
 */
export const createPayment = async (req, res) => {
    let debugPrice = 'N/A';
    try {
        const { electionId } = req.body;
        const election = await Election.findById(electionId);

        if (!election) {
            return res.status(404).json({ success: false, message: 'Elección no encontrada' });
        }

        debugPrice = election.price;
        const unitPriceNum = Number(election.price) || 15000;

        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const successUrl = `${baseUrl}/dashboard?payment=success`;

        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [
                    {
                        id: electionId.toString(),
                        title: `Activación: ${election.title.substring(0, 20)}`,
                        unit_price: unitPriceNum,
                        quantity: 1,
                        currency_id: 'CLP'
                    }
                ],
                back_urls: {
                    success: `${baseUrl}/dashboard?payment=success`,
                    failure: `${baseUrl}/dashboard?payment=failure`,
                    pending: `${baseUrl}/dashboard?payment=pending`
                },
                external_reference: electionId.toString(),
                metadata: {
                    election_id: electionId.toString(),
                    user_id: req.user?.id || 'anonymous'
                }
            }
        });

        res.json({ success: true, init_point: result.init_point });
    } catch (error) {
        console.error('MercadoPago Error:', error);
        res.status(500).json({
            success: false,
            error: `Error de Mercado Pago: ${error.message}`,
            debug: { priceInDb: debugPrice }
        });
    }
};

/**
 * Handle Webhook (IPN) from Mercado Pago
 */
export const handleWebhook = async (req, res) => {
    try {
        const { type, data } = req.body;

        if (type === 'payment') {
            const paymentId = data.id;
            // In a real scenario, you'd fetch payment details from MP using paymentId
            // and get the election_id from metadata.
            // For now, let's assume we can find the election by some means or 
            // the user will manually confirm if the webhook is just a ping.
            // BUT, to be professional, let's look for the election in the request if possible
            // or use the manual confirmation for now since IPN needs a real public URL.
            console.log(`Payment received for ID: ${paymentId}`);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook Error:', error);
        res.sendStatus(500);
    }
};

/**
 * Temp: Manually confirm payment for demo purposes
 * POST /api/payments/confirm/:electionId
 */
export const confirmPaymentManual = async (req, res) => {
    try {
        const { electionId } = req.params;
        const election = await Election.findByIdAndUpdate(
            electionId,
            { isPaid: true, status: 'active' },
            { new: true }
        );
        res.json({ success: true, data: election });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
