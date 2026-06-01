const express = require('express');
const app = express();
app.use(express.json({limit:'10mb'}));

app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Headers','*');
  res.header('Access-Control-Allow-Methods','*');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

const conversas = {};

app.post('/webhook', async(req,res)=>{
  res.sendStatus(200);
  try{
    const body = req.body;
    if(body.event !== 'messages.upsert') return;
    const msg = body.data?.messages?.[0] || body.data;
    if(!msg || msg.key?.fromMe) return;
    const telefone = msg.key?.remoteJid?.replace('@s.whatsapp.net','');
    if(!telefone) return;
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
    if(!texto) return;
    console.log(`Mensagem de ${telefone}: ${texto}`);
    if(!conversas[telefone]) conversas[telefone]=[];
    const resposta = await processarIA(texto, conversas[telefone]);
    conversas[telefone].push({role:'user',content:texto});
    conversas[telefone].push({role:'assistant',content:resposta});
    if(conversas[telefone].length>20) conversas[telefone]=conversas[telefone].slice(-20);
    await enviarWA(telefone, resposta);
  }catch(e){console.error('Erro webhook:',e);}
});

app.post('/claude', async(req,res)=>{
  try{
    const {messages, system, max_tokens} = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01'
      },
      body: JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens: max_tokens||600,
        system: system||'',
        messages
      })
    });
    const data = await response.json();
    res.json(data);
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

async function processarIA(texto, historico){
  try{
    const msgs = [...historico, {role:'user',content:texto}];
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens:500,
        system:`Você é Marina, recrutadora especializada da Hunters Manpower, empresa de mão de obra marítima e offshore. Seja cordial, profissional e objetiva. Valorize: disponibilidade, educação, comportamento, inglês, experiência e caráter. Se o candidato estiver ocupado, não insista - diga: "Gostaria de abençoar alguém com essa vaga? Pode enviar meu contato ou me enviar o contato que eu mesmo ligo." Pergunte sobre certificações marítimas (STCW, médico offshore, etc). Responda sempre em português.`,
        messages: msgs
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || 'Olá! Como posso ajudar?';
  }catch(e){return 'Olá! Tudo bem? Sou da Hunters Manpower. Pode me falar sobre sua experiência?';}
}

async function enviarWA(telefone, mensagem){
  try{
    await fetch(`${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},
      body:JSON.stringify({number:telefone,text:mensagem})
    });
  }catch(e){console.error('Erro WA:',e);}
}

app.get('/', (req,res)=>{
  res.json({status:'Hunters Manpower Webhook ativo!',versao:'2.0'});
});

const PORT = process.env.PORT||3001;
app.listen(PORT,()=>console.log(`Webhook rodando na porta ${PORT}`));
