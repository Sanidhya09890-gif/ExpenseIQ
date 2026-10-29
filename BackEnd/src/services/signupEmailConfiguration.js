'use strict';

function validEmail(value) {
    if (typeof value !== 'string' || value.length > 254) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    return local.length > 0 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') &&
        !local.includes('..') && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) &&
        domain.includes('.') && domain.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
function emailConfiguration(env = process.env) {
    const provider = env.EMAIL_PROVIDER || 'resend';
    if (provider === 'resend' && env.RESEND_API_KEY && validEmail(env.RESEND_FROM_EMAIL)) {
        return { provider, apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL };
    }
    if (provider === 'brevo' && typeof env.BREVO_API_KEY === 'string' && env.BREVO_API_KEY.trim() &&
        !/[\r\n\0]/.test(env.BREVO_API_KEY) && validEmail(env.BREVO_SENDER_EMAIL) &&
        typeof env.BREVO_SENDER_NAME === 'string' && env.BREVO_SENDER_NAME.trim() &&
        env.BREVO_SENDER_NAME.length <= 100 && !/[\r\n\0]/.test(env.BREVO_SENDER_NAME)) {
        return { provider, apiKey: env.BREVO_API_KEY, from: env.BREVO_SENDER_EMAIL, fromName: env.BREVO_SENDER_NAME.trim() };
    }
    if (provider === 'smtp' && env.SMTP_HOST === 'smtp.gmail.com' && String(env.SMTP_PORT) === '465' &&
        validEmail(env.SMTP_USER) && typeof env.SMTP_APP_PASSWORD === 'string' && env.SMTP_APP_PASSWORD.trim() &&
        !/[\r\n\0]/.test(env.SMTP_APP_PASSWORD) && typeof env.SMTP_FROM_NAME === 'string' &&
        env.SMTP_FROM_NAME.trim() && env.SMTP_FROM_NAME.length <= 100 && !/[\r\n\0]/.test(env.SMTP_FROM_NAME)) {
        return { provider, host: 'smtp.gmail.com', port: 465, user: env.SMTP_USER,
            password: env.SMTP_APP_PASSWORD, fromName: env.SMTP_FROM_NAME.trim() };
    }
    throw new Error('Email provider configuration unavailable');
}
module.exports = { validEmail, emailConfiguration };
