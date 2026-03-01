import nodemailer from 'nodemailer';

// Create the transporter. Uses Gmail SMTP by default.
// Configure SMTP_USER and SMTP_PASS in your .env file.
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
};

/**
 * Send a voter registration email with their unique voting key.
 * @param {object} opts
 * @param {string} opts.to         - Voter email address
 * @param {string} opts.name       - Voter name
 * @param {string} opts.votingKey  - 6-digit voting key
 * @param {string} opts.electionTitle
 */
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
                <p style="color: #475569; font-size: 15px;">A continuación encontrará su clave de votación para el proceso: <strong>${electionTitle}</strong></p>
                <div style="background: #f1f5f9; border: 2px dashed #3b82f6; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                    <p style="color: #64748b; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">Clave de Votación</p>
                    <p style="color: #1e293b; font-size: 48px; font-weight: 900; letter-spacing: 12px; margin: 0; font-family: monospace;">${votingKey}</p>
                </div>
                <p style="color: #ef4444; font-size: 13px; background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; border-radius: 4px;">
                    <strong>⚠ Importante:</strong> No comparta esta clave con nadie. Es de uso exclusivo y Personal.
                </p>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Ballots Einsoft &mdash; Tecnología Electoral al Servicio de Chile</p>
            </div>
        </div>`;

    await transporter.sendMail({
        from: `"Ballots Einsoft" <${process.env.SMTP_USER}>`,
        to,
        subject: `🗳️ Clave de Votación — ${electionTitle}`,
        html,
    });
    console.log(`[Email] Voting key sent to ${to}`);
}

/**
 * Send a vote confirmation email after a vote is cast.
 * @param {object} opts
 * @param {string} opts.to           - Voter email address
 * @param {string} opts.name         - Voter name
 * @param {string} opts.rut          - Voter RUT/DNI
 * @param {string} opts.electionTitle
 * @param {string} opts.voteId       - MongoDB _id of the ballot
 * @param {string} opts.ip           - IP address of the voter
 * @param {string} opts.hash         - Blockchain SHA-256 hash
 * @param {Date}   opts.date
 */
export async function sendVoteConfirmationEmail({ to, name, rut, electionTitle, voteId, ip, date, hash }) {
    const transporter = createTransporter();
    const formattedDate = new Date(date).toLocaleString('es-CL', { timeZone: 'America/Santiago' });

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 32px; border-radius: 12px;">
            <div style="background: linear-gradient(135deg, #1e293b, #334155); padding: 24px; border-radius: 10px; text-align: center; margin-bottom: 24px;">
                <h1 style="color: #fff; margin: 0; font-size: 24px;">Ballots <span style="color: #60a5fa;">Einsoft</span></h1>
                <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Web3 Trusted Voting Engine</p>
            </div>
            <div style="background: #ffffff; border-radius: 10px; padding: 32px; border: 1px solid #e2e8f0;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="width: 64px; height: 64px; background: #dcfce7; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                        <span style="font-size: 32px;">⛓️</span>
                    </div>
                    <h2 style="color: #15803d; margin: 0; font-size: 22px;">Blockchain Verified Vote</h2>
                </div>
                <p style="color: #334155; font-size: 16px;">Estimado/a <strong>${name}</strong>,</p>
                <p style="color: #475569; font-size: 15px;">Su votación para <strong>${electionTitle}</strong> ha sido verificada e incorporada a nuestro ledger seguro. Guarde este certificado:</p>
                
                <div style="background: #1e293b; color: #60a5fa; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 11px; margin: 20px 0; border: 1px solid #334155; word-break: break-all;">
                    <span style="color: #94a3b8; display: block; margin-bottom: 5px;">VERIFICATION_HASH (SHA-256):</span>
                    ${hash}
                </div>

                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
                    <tr style="background: #f8fafc;"><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569; width: 40%;">RUT/DNI</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b; font-family: monospace;">${rut}</td></tr>
                    <tr><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569;">Transaction ID</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b; font-family: monospace; font-size: 12px;">${voteId}</td></tr>
                    <tr style="background: #f8fafc;"><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569;">Fecha y Hora</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b;">${formattedDate}</td></tr>
                    <tr><td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #475569;">Nodo IP</td><td style="padding: 12px; border: 1px solid #e2e8f0; color: #1e293b; font-family: monospace;">${ip}</td></tr>
                </table>
                <p style="color: #ef4444; font-size: 13px; background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; border-radius: 4px;">
                    <strong>Seguridad Einsoft:</strong> Este voto es inmutable. El hash vincula este registro al voto anterior de la cadena, asegurando la integridad total del proceso.
                </p>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Einsoft Ballots &mdash; Blockchain Trusted Voting</p>
            </div>
        </div>`;

    await transporter.sendMail({
        from: `"Einsoft Ballots" <${process.env.SMTP_USER}>`,
        to,
        subject: `⛓️ Voto Verificado en Ledger — ${electionTitle}`,
        html,
    });
    console.log(`[Email] Blockchain vote confirmation sent to ${to}`);
}
