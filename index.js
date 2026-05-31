const express = require('express');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const EVO_URL = process.env.EVO_URL || 'http://localhost:8080';
const EVO_INSTANCE = process.env.EVO_INSTANCE || 'Hunters';
const EVO_KEY = process.env.EVO_KEY;

const PERFIL_ROGERIO = `Você é um assistente de recrutamento da Hunters Manpower, empresa especializada em mão de obra marítima e offshore. Você representa Rogério (Maninho), Diretor da empresa.

PERSONALIDADE:
- Tom informal e amigável, nunca grosseiro
- Se apresenta como: "Aqui é o Rogério (Maninho), Diretor da Hunters Manpower"
- Direto e objetivo, respeita o tempo do candidato

CRITÉRIOS QUE VALORIZA (em ordem):
1. Disponibilidade imediata
2. Educação e bom comportamento
3. Inglês
4. Experiência embarcada
5. Certificações válidas (CEFET, HUET, OPITO, H2S, ACLS...)
6. Caráter

REPROVA IMEDIATAMENTE: grosseria ou falta de educação (encerra a conversa educadamente)

SE CANDIDATO ESTIVER TRABALHANDO: Não insiste. Usa EXATAMENTE essa frase:
"Gostaria de abençoar alguém com essa vaga? Se quiser pode enviar meu contato ou me enviar o contato que eu mesmo ligo pra ele."

FLUXO DA CONVERSA:
1. Cumprimentar e perguntar disponibilidade
2. Perguntar certificações que possui
3. Perguntar experiência embarcada (anos/função)
4. Perguntar inglês (básico/intermediário/avançado)
5. Se aprovado: pedir currículo
6. Agendar entrevista com aprovados

IMPORTANTE: Responda sempre em português, seja breve e natural como numa conversa de WhatsApp.`;

async function enviarMensagem(telefone, texto) {
  const tel = telefone.replace(/\D/g, '');
  const numero = tel.length <= 11 ? '55' + tel : tel;
  
  const response = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
    method: 'POST',
    headers: { 'apikey': EVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: numero, textMessage: { text: texto } })
  });
  return response.json();
}

async function processarComIA(mensagem, historico) {
  const messages = historico.map(h => ({ role: h.role, content: h.content }));
  messages.push({ role: 'user', content: mensagem });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: PERFIL_ROGERIO,
      messages: messages
    })
  });

  const data = await response.json();
  return data.content?.[0]?.text || 'Olá! Tudo bem? Sou da Hunters Manpower. Pode me falar mais sobre você?';
}

// Histórico de conversas em memória
const conversas = {};

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  
  try {
    const body = req.body;
    const evento = body.event;
    
    if (evento !== 'messages.upsert') return;
    
    const msg = body.data?.messages?.[0] || body.data;
    if (!msg) return;
    
    const fromMe = msg.key?.fromMe;
    if (fromMe) return;
    
    const telefone = msg.key?.remoteJid?.replace('@s.whatsapp.net', '');
    if (!telefone) return;
    
    const texto = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || '';
    
    if (!texto) return;
    
    console.log(`Mensagem de ${telefone}: ${texto}`);
    
    if (!conversas[telefone]) conversas[telefone] = [];
    
    const resposta = await processarComIA(texto, conversas[telefone]);
    
    conversas[telefone].push({ role: 'user', content: texto });
    conversas[telefone].push({ role: 'assistant', content: resposta });
    
    if (conversas[telefone].length > 20) {
      conversas[telefone] = conversas[telefone].slice(-20);
    }
    
    await enviarMensagem(telefone, resposta);
    console.log(`Resposta enviada para ${telefone}: ${resposta}`);
    
  } catch (error) {
    console.error('Erro:', error);
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'Hunters Manpower Webhook ativo!', versao: '1.0' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
