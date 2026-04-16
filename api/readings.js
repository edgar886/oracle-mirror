import { createHash } from 'crypto';

// Verify the session token (reused logic from verify.js)
function verifyToken(token) {
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const { user, exp, sig } = decoded;

        if (Date.now() > exp) return null;

        const secret = process.env.AUTH_SECRET || process.env.ANTHROPIC_API_KEY || 'oracle-mirror-secret';
        const payload = `${user}:${exp}`;
        const expectedSig = createHash('sha256').update(payload + secret).digest('hex');

        if (sig !== expectedSig) return null;

        return user.toLowerCase();
    } catch {
        return null;
    }
}

// Upstash Redis REST helper
async function redis(command) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
        throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN must be set');
    }

    const res = await fetch(`${url}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(command)
    });

    return res.json();
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Auth check
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const user = verifyToken(token);

    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // GET - Load all readings for user (includes all family members)
        if (req.method === 'GET') {
            const { result: keys } = await redis(["KEYS", `readings:${user}:*`]);

            if (!keys || keys.length === 0) {
                return res.status(200).json({ readings: {} });
            }

            // MGET all values at once
            const { result: values } = await redis(["MGET", ...keys]);

            const readings = {};
            keys.forEach((key, i) => {
                // key format: readings:user:memberKey:section:period
                const parts = key.split(':');
                if (parts.length === 5) {
                    const memberKey = parts[2];
                    const section = parts[3];
                    const period = parts[4];
                    const rKey = `oracle_${memberKey}_${section}_${period}`;
                    try {
                        readings[rKey] = JSON.parse(values[i]);
                    } catch {
                        readings[rKey] = values[i];
                    }
                } else if (parts.length === 4) {
                    const section = parts[2];
                    const period = parts[3];
                    const rKey = `oracle_${user}_${section}_${period}`;
                    try {
                        readings[rKey] = JSON.parse(values[i]);
                    } catch {
                        readings[rKey] = values[i];
                    }
                }
            });

            return res.status(200).json({ readings });
        }

        // POST - Save a reading (per family member)
        if (req.method === 'POST') {
            const { memberKey, section, period, text } = req.body;

            if (!section || !period || !text) {
                return res.status(400).json({ error: 'section, period, and text are required' });
            }

            const member = memberKey || user;
            const key = `readings:${user}:${member}:${section}:${period}`;
            const value = JSON.stringify({ text, timestamp: Date.now() });

            await redis(["SET", key, value]);

            return res.status(200).json({ success: true });
        }

        // DELETE - Clear a reading
        if (req.method === 'DELETE') {
            const { memberKey, section, period } = req.body;

            if (!section || !period) {
                return res.status(400).json({ error: 'section and period are required' });
            }

            const member = memberKey || user;
            const key = `readings:${user}:${member}:${section}:${period}`;
            await redis(["DEL", key]);

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Readings API error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
