import express from 'express';
import { puter } from '@heyputer/puter.js';

const app = express();
app.use(express.json());

// CORS headers for compatibility
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Anthropic compatible /v1/messages endpoint with streaming support
app.post('/v1/messages', async (req, res) => {
  try {
    // Extract messages from Anthropic request format
    const messages = req.body.messages;
    const stream = req.body.stream === true;
    
    // Build full prompt from message history
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    if (stream) {
      // Set SSE headers for streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Stream response from Puter AI with callback handler
      let fullResponse = '';
      
      await puter.ai.chat(prompt, { 
        model: "z-ai/glm-5.1",
        stream: true,
        onChunk: (chunk) => {
          fullResponse += chunk;
          
          // Send chunk in Anthropic SSE format
          const eventData = JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: chunk
            }
          });
          
          res.write(`data: ${eventData}\n\n`);
        }
      });

      // Send final message stop event
      const stopEvent = JSON.stringify({
        type: "message_stop",
        message: {
          id: "msg_puterglm_" + Date.now(),
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: fullResponse }],
          model: "glm-5.1",
          stop_reason: "end_turn",
          usage: { 
            input_tokens: Math.ceil(prompt.length / 4), 
            output_tokens: Math.ceil(fullResponse.length / 4) 
          }
        }
      });
      
      res.write(`data: ${stopEvent}\n\n`);
      res.end();
    } else {
      // Non-streaming response
      const response = await puter.ai.chat(prompt, { 
        model: "z-ai/glm-5.1",
        stream: false 
      });

      res.json({
        id: "msg_puterglm_" + Date.now(),
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: response }],
        model: "glm-5.1",
        stop_reason: "end_turn",
        usage: { 
          input_tokens: Math.ceil(prompt.length / 4), 
          output_tokens: Math.ceil(response.length / 4) 
        }
      });
    }
  } catch (e) {
    console.error('Proxy error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: { type: "api_error", message: e.message } });
    } else {
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Puter proxy running on http://localhost:${PORT}`);
  console.log('');
  console.log('Configure Claude Code with:');
  console.log(`  export ANTHROPIC_BASE_URL="http://localhost:${PORT}"`);
  console.log(`  export ANTHROPIC_AUTH_TOKEN="dummy"`);
  console.log('');
  console.log('Then run `claude` normally. All requests will route through Puter.js GLM-5.1');
});