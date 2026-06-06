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

// Certificados com validade de 5 anos
const VALIDADE_5_ANOS = ['CBSP','THUET','CIR','STCW'];

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
7. Coleta de documentos: peça currículo e fotos dos certificados.
8. Encerramento: informe que Rogério, Marcelo ou Anderson entrará em contato para agendar a entrevista.

GLOSSÁRIO DE FUNÇÕES E SIGLAS (use SOMENTE estes significados; NUNCA invente o que uma sigla significa — se não souber, pergunte ao candidato):
NÁUTICA/CONVÉS: CLC = Capitão de Longo Curso; CCB = Capitão de Cabotagem; 1ON = Primeiro Oficial de Náutica; 2ON = Segundo Oficial de Náutica; MCB = Mestre de Cabotagem; CTR = Contramestre; MNC = Marinheiro de Convés; MOC = Moço de Convés; MAC = Auxiliar de Convés.
MÁQUINAS: OSM = Oficial Superior de Máquinas; 1OM = Primeiro Oficial de Máquinas; 2OM = Segundo Oficial de Máquinas; CDM = Condutor de Máquinas; ELT = Eletricista; MNM = Marinheiro de Máquinas; MOM = Moço de Máquinas; MAM = Auxiliar de Máquinas.
SAÚDE/SERVIÇOS: CZR = Cozinheiro; TAA = Taifeiro; ENF = Enfermeiro.
OFFSHORE: BCO = Ballast Control Operator (operador de controle de lastro); OGD = Guindasteiro; TST = Técnico de Segurança do Trabalho; HA = Homem de Área; IST = Instrumentista; Tec Mec = Técnico Mecânico; Rigger = Rigger; Sup Carg = Supervisor de Carga; Sup Merg = Supervisor de Mergulho; Mont And = Montador de Andaime; BBD = Bombeador; Sold = Soldador; Cald = Caldeireiro; ROP = Radioperador; Mooring Master = Mooring Master; OPC = Operador de Utilidades/Caldeira.
TERMOS: FPSO = plataforma flutuante de produção; PLSV = embarcação de lançamento de dutos; ROV = robô submarino; DP = posicionamento dinâmico; DSV = embarcação de apoio a mergulho; SMS = Saúde, Meio Ambiente e Segurança; EPI/EPC = equipamentos de proteção.
Se o candidato citar uma sigla que não está nesta lista, NÃO adivinhe — pergunte educadamente o que ele faz nessa função.


- Quando receber a foto/PDF de um certificado, o sistema já verifica a validade para você e te informa o VEREDITO (válido ou vencido) numa observação técnica entre colchetes. Confie nesse veredito e comunique ao candidato de forma natural e educada.
- Se o veredito disser VENCIDO, avise com clareza (ex: "Notei que seu THUET venceu em [data]. Para a vaga ele precisa estar válido. Você consegue renovar?").
- Se disser VÁLIDO, confirme positivamente (ex: "Seu CBSP está válido até [data], ótimo!").
- Quando receber um CURRÍCULO, leia a experiência, funções e tempo de embarque, e comente de forma natural.
- Se o documento estiver ilegível, peça com educação para reenviar com mais nitidez.

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
    const messageId = msg.key?.id;

    let texto = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || '';

    let midia = null;

    const imagem = msg.message?.imageMessage;
    const documento = msg.message?.documentMessage
      || msg.message?.documentWithCaptionMessage?.message?.documentMessage;
    const audio = msg.message?.audioMessage;

    if(imagem){
      console.log(`Imagem recebida de ${telefone}, baixando...`);
      const base64 = await baixarMidia(messageId);
      if(base64){
        midia = { tipo:'image', media_type: imagem.mimetype || 'image/jpeg', dados: base64 };
        if(!texto) texto = imagem.caption || 'Segue o documento em imagem.';
      } else {
        texto = 'Recebi sua imagem mas não consegui abrir. Pode reenviar, por favor?';
      }
    } else if(documento){
      const mime = documento.mimetype || '';
      console.log(`Documento recebido de ${telefone} (${mime}), baixando...`);
      const base64 = await baixarMidia(messageId);
      if(base64 && mime.includes('pdf')){
        midia = { tipo:'document', media_type:'application/pdf', dados: base64 };
        if(!texto) texto = 'Segue meu certificado em PDF.';
      } else if(base64){
        texto = 'Recebi seu arquivo. Se for o currículo, pode me mandar em PDF ou foto? Assim consigo analisar melhor.';
      } else {
        texto = 'Recebi seu arquivo mas não consegui abrir. Pode reenviar, por favor?';
      }
    } else if(audio && !texto){
      console.log(`Áudio recebido de ${telefone}, transcrevendo...`);
      texto = await transcreverAudio(messageId);
    }

    if(!texto && !midia) return;
    console.log(`Mensagem de ${telefone}: ${texto}${midia?' [+ '+midia.tipo+']':''}`);

    // Se houver mídia visual (imagem/PDF), verifica se é certificado e calcula validade
    let veredito = '';
    if(midia){
      veredito = await verificarCertificado(midia);
      if(veredito) console.log(`Veredito: ${veredito}`);
    }

    if(!conversas[telefone]) conversas[telefone]=[];
    const resposta = await processarIA(texto, conversas[telefone], midia, veredito);

    conversas[telefone].push({role:'user',content: texto + (midia?` [enviou um documento]`:'')});
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

// Endpoint de login do app: confere a senha guardada no Render (APP_SENHA)
app.post('/login', (req,res)=>{
  try{
    const { senha } = req.body;
    if(!process.env.APP_SENHA){
      return res.status(500).json({ok:false, erro:'Senha do app não configurada no servidor.'});
    }
    if(senha && senha === process.env.APP_SENHA){
      return res.json({ok:true});
    }
    return res.status(401).json({ok:false});
  }catch(e){
    res.status(500).json({ok:false, erro:e.message});
  }
});
function blocoMidia(midia){
  return midia.tipo === 'image'
    ? { type:'image', source:{ type:'base64', media_type: midia.media_type, data: midia.dados } }
    : { type:'document', source:{ type:'base64', media_type:'application/pdf', data: midia.dados } };
}

// ETAPA 1: IA extrai datas do certificado (JSON). ETAPA 2: código calcula validade.
async function verificarCertificado(midia){
  try{
    const instrucao = `Analise este documento. Se NÃO for um certificado (ex: currículo, foto pessoal, outro), responda apenas: {"certificado":false}.
Se for um certificado, responda APENAS com um JSON, sem texto ao redor, neste formato:
{"certificado":true,"nome":"NOME DO CERTIFICADO (ex: CBSP, THUET, CIR, STCW ou outro)","data_validade":"DD/MM/AAAA ou null se não houver","data_conclusao":"DD/MM/AAAA ou null se não houver"}
Use null (sem aspas) quando a data não existir no documento. Não invente datas.`;

    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens:300,
        system:'Você extrai dados de documentos e responde somente em JSON puro, sem markdown, sem explicação.',
        messages:[{role:'user', content:[ blocoMidia(midia), {type:'text', text:instrucao} ]}]
      })
    });
    const d = await r.json();
    let txt = (d.content?.[0]?.text || '').replace(/```json|```/g,'').trim();
    let dados;
    try{ dados = JSON.parse(txt); }catch(e){ console.error('JSON inválido do extrator:', txt); return ''; }

    if(!dados.certificado) return ''; // não é certificado, segue conversa normal

    const nome = (dados.nome||'').toUpperCase();
    // Determina a data de vencimento
    let vencimento = parseData(dados.data_validade);
    let origemCalculo = '';
    if(!vencimento && dados.data_conclusao){
      const concl = parseData(dados.data_conclusao);
      if(concl && VALIDADE_5_ANOS.some(c=>nome.includes(c))){
        vencimento = new Date(concl); vencimento.setFullYear(vencimento.getFullYear()+5);
        origemCalculo = ` (calculado: concluído em ${dados.data_conclusao} + 5 anos)`;
      }
    }

    if(!vencimento){
      return `[OBSERVAÇÃO TÉCNICA: documento identificado como certificado ${nome||''}, mas não foi possível determinar a validade. Peça ao candidato para confirmar a data de validade ou de conclusão.]`;
    }

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const venc = new Date(vencimento); venc.setHours(0,0,0,0);
    const vencStr = venc.toLocaleDateString('pt-BR');
    const status = venc < hoje ? 'VENCIDO' : 'VÁLIDO';
    return `[OBSERVAÇÃO TÉCNICA (não mostre os colchetes ao candidato): certificado ${nome||''} está ${status}. Vencimento: ${vencStr}${origemCalculo}.]`;
  }catch(e){ console.error('Erro verificar certificado:',e); return ''; }
}

// Converte "DD/MM/AAAA" (ou variações) em Date. Retorna null se não der.
function parseData(s){
  if(!s || s==='null') return null;
  const m = String(s).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){
    let [_,d,mes,a] = m;
    if(a.length===2) a = '20'+a;
    const dt = new Date(Number(a), Number(mes)-1, Number(d));
    return isNaN(dt) ? null : dt;
  }
  // só mês/ano (MM/AAAA)
  const m2 = String(s).match(/(\d{1,2})[\/\-.](\d{4})/);
  if(m2){ const dt = new Date(Number(m2[2]), Number(m2[1])-1, 1); return isNaN(dt)?null:dt; }
  return null;
}

async function processarIA(texto, historico, midia, veredito){
  try{
    let conteudoUser;
    const textoFinal = veredito ? `${texto}\n${veredito}` : texto;
    if(midia){
      conteudoUser = [ blocoMidia(midia), { type:'text', text: textoFinal } ];
    } else {
      conteudoUser = textoFinal;
    }
    const msgs = [...historico, {role:'user', content: conteudoUser}];
    const hoje = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'long',year:'numeric'});
    const systemComData = `DATA DE HOJE: ${hoje}.\n\n` + SYSTEM_MARINA;
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens:500,
        system: systemComData,
        messages: msgs
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || 'Olá! Tudo bem?';
  }catch(e){console.error('Erro IA:',e); return 'Olá! Tudo bem? Sou da Hunters Manpower.';}
}

async function baixarMidia(messageId){
  try{
    const rb = await fetch(`${process.env.EVO_URL}/chat/getBase64FromMediaMessage/${process.env.EVO_INSTANCE}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},
      body: JSON.stringify({ message:{ key:{ id: messageId } }, convertToMp4:false })
    });
    const db = await rb.json();
    const base64 = db?.base64 || db?.media || db?.buffer;
    if(!base64) console.error('Sem base64 da mídia:', JSON.stringify(db).slice(0,300));
    return base64 || null;
  }catch(e){ console.error('Erro baixar mídia:',e); return null; }
}

async function transcreverAudio(messageId){
  try{
    if(!process.env.OPENAI_API_KEY){
      return 'Recebi seu áudio, mas no momento consigo ler apenas mensagens de texto. Pode me escrever, por favor?';
    }
    const base64 = await baixarMidia(messageId);
    if(!base64) return 'Recebi seu áudio, mas não consegui abrir. Pode me escrever, por favor?';
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
  res.json({status:'Hunters Manpower Webhook ativo!',versao:'2.7'});
});

const PORT = process.env.PORT||3001;
app.listen(PORT,()=>console.log(`Webhook rodando na porta ${PORT}`));
