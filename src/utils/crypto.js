import crypto from 'crypto';

export const generateToken = () => {
    return crypto.randomBytes(20).toString('hex');
};

export const hashToken = (token) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};
