export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    try {
        const { prompt, model, max_tokens } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Force a current model server-side. Older clients may still send
        // retired model IDs (e.g. claude-sonnet-4-*), which return 404.
        const CURRENT_MODEL = 'claude-sonnet-5';
        const requestedModel = (typeof model === 'string' && !/^claude-sonnet-4/.test(model))
            ? model
            : CURRENT_MODEL;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: requestedModel,
                // claude-sonnet-5 uses adaptive thinking (can't be disabled) and
                // emits a leading "thinking" content block that eats output tokens,
                // so give ample room to avoid truncating the actual answer.
                max_tokens: Math.max(Number(max_tokens) || 1500, 3000),
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'API error' });
        }

        // Newer models return content = [thinking block, ...text blocks]. The
        // frontend reads data.content[0].text, so collapse all text blocks into
        // a single leading text block (drops thinking/other block types).
        if (data && Array.isArray(data.content)) {
            const text = data.content
                .filter(b => b && b.type === 'text' && typeof b.text === 'string')
                .map(b => b.text)
                .join('\n\n');
            if (text) data.content = [{ type: 'text', text }];
        }

        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
