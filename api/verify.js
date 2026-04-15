import { createHash } from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { token } = req.body;

        if (!token) {
            return res.status(401).json({ valid: false });
        }

        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const { user, exp, sig } = decoded;

        if (Date.now() > exp) {
            return res.status(401).json({ valid: false, error: 'Token expired' });
        }

        const secret = process.env.AUTH_SECRET || process.env.ANTHROPIC_API_KEY || 'oracle-mirror-secret';
        const payload = `${user}:${exp}`;
        const expectedSig = createHash('sha256').update(payload + secret).digest('hex');

        if (sig !== expectedSig) {
            return res.status(401).json({ valid: false });
        }

        return res.status(200).json({
            valid: true,
            user: user.toLowerCase(),
            displayName: user.charAt(0).toUpperCase() + user.slice(1).toLowerCase()
        });
    } catch (error) {
        return res.status(401).json({ valid: false });
    }
}
