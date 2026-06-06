const express = require('express');
const app = express();
app.use(express.json({limit:'25mb'}));
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Headers','*');
  res.header('Access-Control-Allow-Methods','*');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

const conversas = {};

// Instruções da Marina: conversa natural, uma coisa de cada vez
const SYSTEM_MARINA = `Você é Marina, recrutadora da Hunters Manpower, empresa com mais de 25 anos fornecendo mão de obra marítima e offshore (plataformas de petróleo).

ESTILO DE CONVERSA (muito importante):
- Converse como uma pessoa de verdade no WhatsApp: mensagens curtas, naturais, informais e educadas.
- Faça UMA pergunta de cada vez. NUNCA liste várias perguntas na mesma mensagem nem despeje um questionário.
- Espere a resposta do candidato antes de seguir para o próximo assunto.
- Puxe o assunto de forma fluida, reagindo ao que a pessoa disse, como num papo natural.
- Não soe robótica nem formal demais. Nada de listas numeradas de requisitos.

O QUE VOCÊ PRECISA DESCOBRIR AO LONGO DA CONVERSA (sem pressa, um de cada vez):
1. Confirmar o interesse na vaga.
2. Experiência da pessoa na área marítima/offshore e função que exerce.
3. Certificados obrigatórios:
   - Marítimo: CIR e STCW.
   - Offshore: CBSP e THUET (NÃO pergunte sobre HUET nem sobre certificado/atestado médico).
4. Certificados específicos da função, quando fizer sentido.
5. Inglês (apenas para oficiais).
6. Disponibilidade para embarque.
7. Coleta de documentos: peça currículo e fotos dos certificados. A validade você lê na própria foto do documento, não calcule.
8. Encerramento: informe que Rogério, Marcelo ou Anderson entrará em contato para agendar a entrevista.

SE A PESSOA NÃO TIVER INTERESSE OU DISPONIBILIDADE:
Não insista. Use a frase: "Gostaria de abençoar alguém com essa vaga? Pode enviar meu contato ou me enviar o contato que eu mesmo ligo."

VALORES DA HUNTERS: disponibilidade, educação, bom comportamento, inglês, experiência e caráter. Falta de cortesia é eliminatória.

Responda sempre em português, de forma cordial e profissional.`;

app.post('/webhook', async(req,res)=>{
  res.sendStatus(200);
  try{
    const body = req.body;
    if(body.event !== 'messages.upsert') return;
    const msg = body.data?.messages?.[0] || body.data;
    if(!msg || msg.key?.fromMe) return;
    const telefone = msg.key?.remoteJid?.replace('@s.whatsapp.net','');
    if(!telefone) return;

    // Texto direto
    let texto = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || '';

    // Áudio: baixar e transcrever
    const audio = msg.message?.audioMessage;
    if(!texto && audio){
      console.log(`Áudio recebido de ${telefone}, transcrevendo...`);
      texto = await transcreverAudio(msg.key?.id, telefone);
    }

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

// Endpoint do app embutido (chat Claude) - mantido igual
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
        max_tokens:400,
        system: SYSTEM_MARINA,
        messages: msgs
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || 'Olá! Tudo bem?';
  }catch(e){return 'Olá! Tudo bem? Sou da Hunters Manpower.';}
}

// Baixa o áudio pela Evolution API e transcreve com a Whisper (OpenAI)
async function transcreverAudio(messageId, telefone){
  try{
    if(!process.env.OPENAI_API_KEY){
      return 'Recebi seu áudio, mas no momento consigo ler apenas mensagens de texto. Pode me escrever, por favor?';
    }
    // 1. Pedir o base64 do áudio para a Evolution API
    const rb = await fetch(`${process.env.EVO_URL}/chat/getBase64FromMediaMessage/${process.env.EVO_INSTANCE}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},
      body: JSON.stringify({ message:{ key:{ id: messageId } }, convertToMp4:false })
    });
    const db = await rb.json();
    const base64 = db?.base64 || db?.media || db?.buffer;
    if(!base64){
      console.error('Sem base64 do áudio:', JSON.stringify(db).slice(0,300));
      return 'Recebi seu áudio, mas não consegui abrir. Pode me escrever, por favor?';
    }
    // 2. Enviar para a Whisper transcrever
    const audioBuffer = Buffer.from(base64,'base64');
    const form = new FormData();
    form.append('file', new Blob([audioBuffer],{type:'audio/ogg'}), 'audio.ogg');
    form.append('model','whisper-1');
    form.append('language','pt');
    const rt = await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body: form
    });
    const dt = await rt.json();
    const transcrito = dt?.text || '';
    console.log(`Transcrição: ${transcrito}`);
    return transcrito || 'Recebi seu áudio mas não entendi. Pode repetir por escrito?';
  }catch(e){
    console.error('Erro transcrição:',e);
    return 'Recebi seu áudio, mas tive um problema para ouvir. Pode me escrever, por favor?';
  }
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
  res.json({status:'Hunters Manpower Webhook ativo!',versao:'2.1'});
});

const PORT = process.env.PORT||3001;
app.listen(PORT,()=>console.log(`Webhook rodando na porta ${PORT}`));
