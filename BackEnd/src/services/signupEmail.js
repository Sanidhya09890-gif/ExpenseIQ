'use strict';
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const { emailConfiguration, validEmail } = require('./signupEmailConfiguration');

// No logging, fallback recipient, or test-address override in application delivery.
async function sendSignupOtp({ email, otp, deliveryId }) {
    let transport;
    try {
        const config = emailConfiguration();
        if (!validEmail(email) || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) throw new Error('Invalid delivery payload');
        const subject = 'ExpenseIQ - Verify your email';
        const text = `Your ExpenseIQ verification code is ${otp}. It expires in 5 minutes. If you did not sign up, ignore this email.`;
        if (config.provider === 'brevo') {
            // HTTPS only: fixed endpoint, no redirects, no retries or SMTP fallback.
            const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
                headers: { 'api-key': config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ sender: { email: config.from, name: config.fromName },
                    to: [{ email }], subject, textContent: text,
                    // The only dynamic content here is an already validated six-digit code.
                    htmlContent: `<p>${text}</p>` }),
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok || response.status !== 201) {
                await response.body?.cancel();
                throw new Error('Brevo acceptance unconfirmed');
            }
            const data = await response.json();
            if (typeof data?.messageId !== 'string' || !data.messageId.trim()) throw new Error('Brevo acceptance unconfirmed');
            return;
        }
        if (config.provider === 'smtp') {
            transport = nodemailer.createTransport({
                host: config.host, port: config.port, secure: true, requireTLS: true,
                auth: { user: config.user, pass: config.password },
                tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: 'smtp.gmail.com' },
                connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000, dnsTimeout: 10000,
                logger: false, debug: false, pool: false, maxRecipients: 1,
                disableFileAccess: true, disableUrlAccess: true
            });
            const info = await transport.sendMail({
                from: { name: config.fromName, address: config.user }, to: [{ address: email }], subject, text
            });
            const accepted = info?.accepted || [];
            if (!info?.messageId || accepted.length !== 1 || !accepted.some(address =>
                (typeof address === 'string' ? address : address?.address)?.toLowerCase() === email.toLowerCase()) ||
                info.rejected?.length || info.pending?.length) throw new Error('SMTP acceptance unconfirmed');
            return;
        }
        const resend = new Resend(config.apiKey, { baseUrl: 'https://api.resend.com' });
        // Never allow SDK debug output to leak provider response details.
        resend.debug = false;
        const { data, error } = await resend.emails.send({
            from: config.from,
            to: [email],
            subject, text
        }, { idempotencyKey: `expenseiq-signup-${deliveryId}`, signal: AbortSignal.timeout(10000) });
        if (error || !data?.id) throw new Error('Email provider did not accept the message');
    } catch {
        // Do not propagate SMTP response text, addresses, credentials or provider details.
        throw new Error('Email provider did not accept the message');
    } finally {
        try { transport?.close(); } catch { /* Never expose transport shutdown details. */ }
    }
}
module.exports = { sendSignupOtp };
