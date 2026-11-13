import nodemailer from "nodemailer";

const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
};

export async function sendVotingKeyEmail({ to, name, votingKey, electionTitle }) {
    const transporter = createTransporter();

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 32px; border-radius: 12px;">
            <div style="background: linear-gradient(135deg, #1e293b, #334155); padding: 24px; border-radius: 10px; text-align: center; margin-bottom: 24px;">
                <h1 style="color: #fff; margin: 0; font-size: 24px;">Ballots <span style="color: #60a5fa;">Einsoft</span></h1>
                <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Plataforma de Votación Electrónica</p>
            </div>
            <div style="background: #ffffff; border-radius: 10px; padding: 32px; border: 1px solid #e2e8f0;">
                <p style="color: #334155; font-size: 16px;">Estimado/a <strong>${name}</strong>,</p>
                <p style="color: #475569; font-size: 15px;">A continuación encontrará su clave de votación de un solo uso para el proceso: <strong>${electionTitle}</strong></p>
                <div style="background: #f1f5f9; border: 2px dashed #3b82f6; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                    <p style="color: #64748b; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">Clave de Votación</p>
                    <p style="color: #1e293b; font-size: 48px; font-weight: 900; letter-spacing: 12px; margin: 0; font-family: monospace;">${votingKey}</p>
                </div>
                <p style="color: #ef4444; font-size: 13px; background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; border-radius: 4px;">
                    <strong>⚠ Importante:</strong> No comparta esta clave con nadie. Es de uso exclusivo y personal.
                </p>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Ballots Einsoft &mdash; Tecnología Electoral Verificable</p>
            </div>
        </div>`;

    await transporter.sendMail({
        from: `"Ballots Einsoft" <${process.env.SMTP_USER}>`,
        to,
        subject: `🗳️ Clave de Votación — ${electionTitle}`,
        html
    });
    console.log(`[Email] Voting key sent to ${to}`);
}

export async function sendVoteConfirmationEmail({
    to,
    name,
    rut,
    electionTitle,
    voteId,
    ip,
    date,
    hash,
    ballotCommitment,
    nullifierHash,
    txHash,
    explorerUrl,
    network
}) {
    const transporter = createTransporter();
    const formattedDate = new Date(date).toLocaleString("es-CL", { timeZone: "America/Santiago" });

    const web3Block = txHash
        ? `
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 12px;">
                <p style="color: #065f46; font-weight: 700; margin: 0 0 8px;">⛓️ Respaldo Web3 On-Chain (${network || "Blockchain"})</p>
                <p style="color: #047857; font-family: monospace; word-break: break-all; margin: 0 0 8px;">TX Hash: ${txHash}</p>
                ${explorerUrl ? `<a href="${explorerUrl}" style="display: inline-block; background: #059669; color: #fff; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-weight: 700;">Verificar en Explorador Blockchain</a>` : ""}
            </div>`
        : `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin: 16px 0; font-size: 12px; color: #475569;">
                Comprobante criptográfico sellado con commitment único y nullifier anónimo.
            </div>`;

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 32px; border-radius: 12px;">
            <div style="background: linear-gradient(135deg, #1e293b, #334155); padding: 24px; border-radius: 10px; text-align: center; margin-bottom: 24px;">
                <h1 style="color: #fff; margin: 0; font-size: 24px;">Ballots <span style="color: #60a5fa;">Einsoft</span></h1>
                <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Web3 Privacy-Preserving Voting Engine</p>
            </div>
            <div style="background: #ffffff; border-radius: 10px; padding: 32px; border: 1px solid #e2e8f0;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h2 style="color: #15803d; margin: 0; font-size: 22px;">Voto Verificado y Sellado</h2>
                </div>
                <p style="color: #334155; font-size: 16px;">Estimado/a <strong>${name}</strong>,</p>
                <p style="color: #475569; font-size: 15px;">Su participación en <strong>${electionTitle}</strong> fue registrada manteniendo su identidad privada y sin revelar su elección en la blockchain:</p>

                <div style="background: #1e293b; color: #60a5fa; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 11px; margin: 20px 0; border: 1px solid #334155; word-break: break-all;">
                    <span style="color: #94a3b8; display: block; margin-bottom: 4px;">BALLOT_COMMITMENT (ZK-STYLE RECEIPT):</span>
                    ${ballotCommitment || hash}
                    <span style="color: #94a3b8; display: block; margin-top: 10px; margin-bottom: 4px;">CHAIN_TIP_HASH (KECCAK-256):</span>
                    ${hash}
                    ${nullifierHash ? `<span style="color: #94a3b8; display: block; margin-top: 10px; margin-bottom: 4px;">ANONYMOUS_NULLIFIER:</span>${nullifierHash}` : ""}
                </div>

                ${web3Block}

                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
                    <tr style="background: #f8fafc;"><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569; width: 40%;">RUT/DNI</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b; font-family: monospace;">${rut}</td></tr>
                    <tr><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569;">Comprobante ID</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b; font-family: monospace; font-size: 12px;">${voteId}</td></tr>
                    <tr style="background: #f8fafc;"><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569;">Fecha y Hora</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b;">${formattedDate}</td></tr>
                    <tr><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569;">IP de Sesión</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b; font-family: monospace;">${ip}</td></tr>
                </table>
                <p style="color: #0369a1; font-size: 13px; background: #f0f9ff; border-left: 4px solid #0284c7; padding: 12px; border-radius: 4px;">
                    <strong>Privacidad e Inmutabilidad:</strong> Su RUT no se almacena en blockchain ni se vincula con su preferencia en la urna.
                </p>
            </div>
        </div>`;

    await transporter.sendMail({
        from: `"Einsoft Ballots" <${process.env.SMTP_USER}>`,
        to,
        subject: `⛓️ Comprobante Web3 de Voto — ${electionTitle}`,
        html
    });
    console.log(`[Email] Web3 vote confirmation sent to ${to}`);
}
