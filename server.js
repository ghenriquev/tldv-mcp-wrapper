const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());

// ==========================================
// UTILITY: Chamar MCP do TLDV
// ==========================================
async function callTLDVMCP(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const mcpMode = process.env.MCP_MODE || 'docker';
    let mcpProcess;

    // Configurar comando baseado no modo
    if (mcpMode === 'docker') {
      mcpProcess = spawn('docker', [
        'run',
        '--rm',
        '--init',
        '-i', // modo interativo para stdio
        '-e', `TLDV_API_KEY=${process.env.TLDV_API_KEY}`,
        'tldv-mcp-server'
      ]);
    } else {
      // Modo Node.js local
      const mcpPath = process.env.TLDV_MCP_PATH;
      if (!mcpPath) {
        return reject(new Error('TLDV_MCP_PATH não configurado'));
      }
      mcpProcess = spawn('node', [mcpPath], {
        env: {
          ...process.env,
          TLDV_API_KEY: process.env.TLDV_API_KEY
        }
      });
    }

    let output = '';
    let errorOutput = '';

    // Enviar comando MCP via stdin
    const mcpRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args
      }
    };

    mcpProcess.stdin.write(JSON.stringify(mcpRequest) + '\n');
    mcpProcess.stdin.end();

    // Coletar resposta
    mcpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    mcpProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error('MCP stderr:', data.toString());
    });

    mcpProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`MCP process exited with code ${code}: ${errorOutput}`));
      }

      try {
        // Parse resposta MCP
        const lines = output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const response = JSON.parse(lastLine);

        if (response.error) {
          return reject(new Error(response.error.message || 'MCP Error'));
        }

        resolve(response.result);
      } catch (err) {
        reject(new Error(`Failed to parse MCP response: ${err.message}\nOutput: ${output}`));
      }
    });

    mcpProcess.on('error', (err) => {
      reject(new Error(`Failed to start MCP process: ${err.message}`));
    });
  });
}

// ==========================================
// ENDPOINT: Health Check
// ==========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tldv-mcp-wrapper',
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// ENDPOINT: Listar Reuniões
// ==========================================
app.post('/api/meetings/list', async (req, res) => {
  try {
    const {
      query,
      startDate,
      endDate,
      participationStatus,
      meetingType,
      limit
    } = req.body;

    const args = {};
    if (query) args.query = query;
    if (startDate) args.startDate = startDate;
    if (endDate) args.endDate = endDate;
    if (participationStatus) args.participationStatus = participationStatus;
    if (meetingType) args.meetingType = meetingType;
    if (limit) args.limit = limit;

    const result = await callTLDVMCP('list_meetings', args);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error listing meetings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// ENDPOINT: Obter Metadados da Reunião
// ==========================================
app.post('/api/meetings/metadata', async (req, res) => {
  try {
    const { meetingId } = req.body;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'meetingId é obrigatório'
      });
    }

    const result = await callTLDVMCP('get_meeting_metadata', { meetingId });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting meeting metadata:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// ENDPOINT: Obter Transcrição
// ==========================================
app.post('/api/meetings/transcript', async (req, res) => {
  try {
    const { meetingId } = req.body;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'meetingId é obrigatório'
      });
    }

    const result = await callTLDVMCP('get_transcript', { meetingId });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting transcript:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// ENDPOINT: Obter Highlights
// ==========================================
app.post('/api/meetings/highlights', async (req, res) => {
  try {
    const { meetingId } = req.body;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'meetingId é obrigatório'
      });
    }

    const result = await callTLDVMCP('get_highlights', { meetingId });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting highlights:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// ENDPOINT: Processar Reuniões (Completo)
// Retorna reuniões com transcrições e matching
// ==========================================
app.post('/api/meetings/process', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      clientes, // Array de clientes do banco
      includeTranscripts = true,
      limit = 100
    } = req.body;

    console.log(`[Process] Buscando reuniões: ${startDate} a ${endDate}`);

    // 1. Listar reuniões
    const listArgs = { limit };
    if (startDate) listArgs.startDate = startDate;
    if (endDate) listArgs.endDate = endDate;

    const meetings = await callTLDVMCP('list_meetings', listArgs);

    console.log(`[Process] Encontradas ${meetings.length} reuniões`);

    // 2. Processar cada reunião
    const processedMeetings = [];

    for (const meeting of meetings) {
      try {
        const processed = {
          tldv_meeting_id: meeting.id,
          titulo: meeting.title || meeting.name,
          data: meeting.date || meeting.happenedAt,
          duracao_minutos: meeting.duration,
          participantes: meeting.participants || [],
          recording_url: meeting.recordingUrl,
          tldv_url: meeting.tldvUrl || meeting.url,
          transcricao: null,
          cliente_id: null,
          matched_by: null,
          matched_confidence: null
        };

        // 3. Buscar transcrição se solicitado
        if (includeTranscripts) {
          try {
            const transcript = await callTLDVMCP('get_transcript', { 
              meetingId: meeting.id 
            });
            processed.transcricao = transcript.text || transcript.content;
          } catch (err) {
            console.error(`[Process] Erro ao buscar transcrição ${meeting.id}:`, err.message);
          }
        }

        // 4. Fazer matching com clientes (se fornecido)
        if (clientes && Array.isArray(clientes)) {
          const match = matchMeeting(processed, clientes);
          if (match) {
            processed.cliente_id = match.cliente_id;
            processed.matched_by = match.method;
            processed.matched_confidence = match.confidence;
          }
        }

        processedMeetings.push(processed);
      } catch (err) {
        console.error(`[Process] Erro ao processar reunião ${meeting.id}:`, err.message);
      }
    }

    console.log(`[Process] Processadas ${processedMeetings.length} reuniões`);

    res.json({
      success: true,
      total: processedMeetings.length,
      data: processedMeetings
    });
  } catch (error) {
    console.error('Error processing meetings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// FUNÇÃO: Matching Algorithm
// ==========================================
function matchMeeting(meeting, clientes) {
  const titulo = (meeting.titulo || '').toLowerCase().trim();
  const participantes = meeting.participantes || [];
  
  if (!titulo) return null;

  // Palavras genéricas para remover
  const GENERIC_WORDS = new Set([
    'hotel', 'pousada', 'beach', 'praia', 'resort', 'flat',
    'apart', 'residence', 'inn', 'hostel', 'eco', 'park',
    'reprotel', '&', 'confirmad', 'alinhamento', 'call',
    'kick', 'off', 'apresentacao', 'resultados', 'cs'
  ]);

  // 1. EMAIL MATCH (confiança 1.0)
  for (const cliente of clientes) {
    if (cliente.email) {
      const clienteEmail = cliente.email.toLowerCase();
      const hasEmailMatch = participantes.some(p => 
        p.email && p.email.toLowerCase() === clienteEmail
      );
      
      if (hasEmailMatch) {
        return {
          cliente_id: cliente.clickup_task_id,
          method: 'email',
          confidence: 1.0
        };
      }
    }
  }

  // 2. SUBSTRING EXACT MATCH (confiança 1.0)
  for (const cliente of clientes) {
    const clienteNome = (cliente.nome || '').toLowerCase().trim();
    if (!clienteNome || clienteNome.length < 3) continue;

    if (titulo.includes(clienteNome) || clienteNome.includes(titulo)) {
      return {
        cliente_id: cliente.clickup_task_id,
        method: 'titulo_substring_exact',
        confidence: 1.0
      };
    }
  }

  // 3. SUBSTRING INVERSE (confiança 0.95)
  for (const cliente of clientes) {
    const clienteNome = (cliente.nome || '').toLowerCase().trim();
    if (!clienteNome || clienteNome.length < 3) continue;

    if (clienteNome.includes(titulo) && titulo.length >= 5) {
      return {
        cliente_id: cliente.clickup_task_id,
        method: 'titulo_substring_inverse',
        confidence: 0.95
      };
    }
  }

  // 4. WORD-BASED MATCH (confiança variável)
  const tituloWords = titulo.split(/\s+/)
    .filter(w => w.length > 2 && !GENERIC_WORDS.has(w));

  if (tituloWords.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const cliente of clientes) {
    const clienteNome = (cliente.nome || '').toLowerCase().trim();
    if (!clienteNome) continue;

    const clienteWords = clienteNome.split(/\s+/)
      .filter(w => w.length > 2 && !GENERIC_WORDS.has(w));

    if (clienteWords.length === 0) continue;

    let matchingWords = 0;
    for (const tWord of tituloWords) {
      for (const cWord of clienteWords) {
        if (tWord.includes(cWord) || cWord.includes(tWord)) {
          matchingWords++;
          break;
        }
      }
    }

    const score = matchingWords / Math.max(tituloWords.length, clienteWords.length);
    
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      const confidence = 0.65 + (score * 0.25); // 0.65 a 0.9
      
      bestMatch = {
        cliente_id: cliente.clickup_task_id,
        method: 'titulo_word_based',
        confidence: Math.round(confidence * 100) / 100
      };
    }
  }

  return bestMatch;
}

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 TLDV MCP Wrapper rodando na porta ${PORT}`);
  console.log(`📋 Endpoints disponíveis:`);
  console.log(`   GET  /health`);
  console.log(`   POST /api/meetings/list`);
  console.log(`   POST /api/meetings/metadata`);
  console.log(`   POST /api/meetings/transcript`);
  console.log(`   POST /api/meetings/highlights`);
  console.log(`   POST /api/meetings/process (COMPLETO)`);
});
