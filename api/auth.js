import { createHash, randomBytes } from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const envKey = `AUTH_USER_${username.toUpperCase()}`;
        const storedHash = process.env[envKey];

        if (!storedHash) {
            await new Promise(r => setTimeout(r, 200));
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const inputHash = createHash('sha256').update(password).digest('hex');

        if (inputHash !== storedHash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const secret = process.env.AUTH_SECRET || process.env.ANTHROPIC_API_KEY || 'oracle-mirror-secret';
        const expires = Date.now() + (7 * 24 * 60 * 60 * 1000);
        const payload = `${username}:${expires}`;
        const signature = createHash('sha256').update(payload + secret).digest('hex');
        const sessionToken = Buffer.from(JSON.stringify({ user: username, exp: expires, sig: signature })).toString('base64');

        return res.status(200).json({
            success: true,
            token: sessionToken,
            user: username.toLowerCase(),
            displayName: username.charAt(0).toUpperCase() + username.slice(1).toLowerCase()
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
