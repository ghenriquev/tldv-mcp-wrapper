# TLDV MCP Wrapper - HTTP para n8n

Wrapper HTTP que expõe o MCP Server do TLDV como API REST para integração com n8n.

## 🚀 Instalação

### Pré-requisitos

1. **TLDV API Key**: Obter em https://tldv.io/app/settings/personal-settings/api-keys
2. **Docker** (recomendado) ou **Node.js 18+**
3. **TLDV MCP Server**: 
   - Via Docker (recomendado): `docker pull tldv-mcp-server` 
   - Via Node.js: Clonar https://github.com/tldv-public/tldv-mcp-server

### Passos

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env e adicionar seu TLDV_API_KEY

# 3. Rodar o servidor
npm start

# Ou em modo desenvolvimento (auto-reload)
npm run dev
```

## 📡 Endpoints API

### Health Check
```bash
GET http://localhost:3010/health
```

### Listar Reuniões
```bash
POST http://localhost:3010/api/meetings/list
Content-Type: application/json

{
  "query": "Reprotel",
  "startDate": "2025-01-01",
  "endDate": "2025-12-31",
  "limit": 100
}
```

**Parâmetros opcionais:**
- `query`: Filtro de busca
- `startDate`: Data início (YYYY-MM-DD)
- `endDate`: Data fim (YYYY-MM-DD)
- `participationStatus`: "hosted", "attended", "all"
- `meetingType`: "zoom", "meet", "teams", "all"
- `limit`: Máximo de reuniões (default: 100)

### Obter Metadados da Reunião
```bash
POST http://localhost:3010/api/meetings/metadata
Content-Type: application/json

{
  "meetingId": "abc123"
}
```

### Obter Transcrição
```bash
POST http://localhost:3010/api/meetings/transcript
Content-Type: application/json

{
  "meetingId": "abc123"
}
```

### Obter Highlights
```bash
POST http://localhost:3010/api/meetings/highlights
Content-Type: application/json

{
  "meetingId": "abc123"
}
```

### Processar Reuniões (Completo) ⭐
**Endpoint mais completo - busca reuniões, transcrições e faz matching com clientes**

```bash
POST http://localhost:3010/api/meetings/process
Content-Type: application/json

{
  "startDate": "2025-01-01",
  "endDate": "2025-12-31",
  "includeTranscripts": true,
  "limit": 100,
  "clientes": [
    {
      "clickup_task_id": "123abc",
      "nome": "Villa Real",
      "email": "contato@villareal.com.br"
    },
    {
      "clickup_task_id": "456def",
      "nome": "Rede Soberano",
      "email": null
    }
  ]
}
```

**Resposta:**
```json
{
  "success": true,
  "total": 5,
  "data": [
    {
      "tldv_meeting_id": "abc123",
      "titulo": "Call Alinhamento - Villa Real",
      "data": "2025-07-09T14:00:00Z",
      "duracao_minutos": 45,
      "participantes": [...],
      "recording_url": "https://...",
      "tldv_url": "https://...",
      "transcricao": "...",
      "cliente_id": "123abc",
      "matched_by": "titulo_substring_exact",
      "matched_confidence": 1.0
    }
  ]
}
```

## 🔧 Uso no n8n

### 1. Configurar HTTP Request Node

**Para endpoint /process (recomendado):**
```
Method: POST
URL: http://localhost:3010/api/meetings/process
Body:
{
  "startDate": "2025-01-01",
  "endDate": "2025-12-31",
  "includeTranscripts": true,
  "clientes": {{ $json.clientes }}
}
```

### 2. Workflow Exemplo

```
[Schedule Trigger]
  ↓
[PostgreSQL: SELECT clientes]
  ↓
[HTTP Request: /api/meetings/process]
  ↓
[Code: Transform data]
  ↓
[PostgreSQL: INSERT reunioes]
```

## 🎯 Algoritmo de Matching

O endpoint `/process` já faz matching automático com 4 níveis:

1. **Email Match** (confiança 1.0)
   - Compara email dos participantes com email do cliente

2. **Substring Exact** (confiança 1.0)
   - "Villa Real" no título → cliente "Villa Real"

3. **Substring Inverse** (confiança 0.95)
   - "Pepita" no título → cliente "Hotel Pepita"

4. **Word-Based** (confiança 0.65-0.9)
   - Remove palavras genéricas
   - Calcula similaridade por palavras
   - Mínimo 50% de match

## ⚙️ Configuração

### Variáveis de Ambiente (.env)

```bash
# TLDV API Key (obrigatório)
TLDV_API_KEY=your_key_here

# Porta do servidor (default: 3010)
PORT=3010

# Modo: "docker" (recomendado) ou "node"
MCP_MODE=docker

# Se usar modo "node", informar path
TLDV_MCP_PATH=/path/to/tldv-mcp-server/dist/index.js
```

## 🐳 Usando Docker

### Build e Run
```bash
# Build da imagem do MCP Server (se não tiver)
git clone https://github.com/tldv-public/tldv-mcp-server
cd tldv-mcp-server
docker build -t tldv-mcp-server .

# Rodar o wrapper
cd ../tldv-mcp-wrapper
npm start
```

## 🔍 Debugging

### Logs
O servidor exibe logs detalhados:
```
[Process] Buscando reuniões: 2025-01-01 a 2025-12-31
[Process] Encontradas 10 reuniões
[Process] Erro ao buscar transcrição abc123: Timeout
[Process] Processadas 9 reuniões
```

### Testar MCP manualmente
```bash
# Verificar se Docker MCP está funcionando
docker run --rm -it -e TLDV_API_KEY=your_key tldv-mcp-server
```

## 📊 Performance

- **Sem transcrições**: ~2-3 seg para 100 reuniões
- **Com transcrições**: ~30-60 seg para 100 reuniões (depende da API TLDV)
- **Matching**: instantâneo (processado no servidor)

## 🚨 Troubleshooting

### Erro: "MCP process exited with code 1"
- Verificar se `TLDV_API_KEY` está configurado
- Verificar se Docker está rodando (modo docker)
- Verificar logs: `docker logs <container_id>`

### Erro: "TLDV_MCP_PATH não configurado"
- Se usar modo "node", configurar path no .env
- Recomendado: usar modo "docker"

### Timeout ao buscar transcrições
- Normal para reuniões muito longas
- Ajustar timeout no código se necessário

## 📝 TODO

- [ ] Cache de transcrições (Redis)
- [ ] Rate limiting
- [ ] Autenticação do wrapper
- [ ] Webhook para notificações
- [ ] Melhorar algoritmo de matching com Levenshtein

## 📄 Licença

MIT
