const express=require('express');
const app=express();
app.use(express.json({limit:'50mb'}));
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type,x-api-key,x-app-senha');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

// ── Supabase (REST direto, sem SDK) ──────────────────────────────────────────
const SUPA_URL = process.env.SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY || '';

async function supaInsert(tabela, dados){
  if(!SUPA_URL||!SUPA_KEY) return;
  try{
    await fetch(`${SUPA_URL}/rest/v1/${tabela}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`,'Prefer':'return=minimal'},
      body:JSON.stringify(dados)
    });
  }catch(e){console.error(`Supabase insert ${tabela}:`,e.message);}
}

async function supaUpsert(tabela, dados, campoConflito){
  if(!SUPA_URL||!SUPA_KEY) return;
  try{
    await fetch(`${SUPA_URL}/rest/v1/${tabela}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`,'Prefer':`resolution=merge-duplicates,return=minimal`,'on-conflict':campoConflito},
      body:JSON.stringify(dados)
    });
  }catch(e){console.error(`Supabase upsert ${tabela}:`,e.message);}
}

async function supaUpdate(tabela, filtro, dados){
  if(!SUPA_URL||!SUPA_KEY) return;
  try{
    const params=Object.entries(filtro).map(([k,v])=>`${k}=eq.${encodeURIComponent(v)}`).join('&');
    await fetch(`${SUPA_URL}/rest/v1/${tabela}?${params}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`,'Prefer':'return=minimal'},
      body:JSON.stringify(dados)
    });
  }catch(e){console.error(`Supabase update ${tabela}:`,e.message);}
}

async function supaSelect(tabela, filtro){
  if(!SUPA_URL||!SUPA_KEY) return null;
  try{
    const params=Object.entries(filtro).map(([k,v])=>`${k}=eq.${encodeURIComponent(v)}`).join('&');
    const r=await fetch(`${SUPA_URL}/rest/v1/${tabela}?${params}&select=*`,{
      headers:{'apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`}
    });
    return await r.json();
  }catch(e){console.error(`Supabase select ${tabela}:`,e.message);return null;}
}

// ── Constantes e estado ──────────────────────────────────────────────────────
const conversas={};
const aprovadosEnviados={};

const VALIDADE_CERT={
  'NR-37':5*365,'NR-35':2*365,'NR-10':2*365,'NR-20':2*365,
  'NR-33':365,'NR-23':365,'NR-05':365,'NR-36':365,'NR-34-ESTANQUEIDADE':365,
  'THUET':4*365,'CBSP-HOMOLOGADO':5*365,'CBSP-PROVISORIO':90,
  'CA-EBS':5*365,'GMDSS':5*365,'STCW':5*365,'CIR':5*365
};

const GLOSSARIO={
  'cbsp':'Certificado Básico de Segurança em Plataformas',
  'thuet':'Técnicas de Sobrevivência e Resgate (OPITO)',
  'ca-ebs':'Certificado de Aprovação — Embarcação de Sobrevivência',
  'cir':'Certificado Internacional de Radiotelefonista',
  'nr-37':'Norma Regulamentadora de Plataformas de Petróleo',
  'nr-35':'Trabalho em Altura','nr-33':'Espaços Confinados',
  'nr-10':'Segurança em Instalações Elétricas',
  'stcw':'Standards of Training, Certification and Watchkeeping',
  'gmdss':'Sistema Global de Socorro e Segurança Marítima',
  'orp':'Oficial de Rádio Plataforma','dp':'Dynamic Positioning',
  'bosun':'Contramestre','pumpman':'Bombeador / Operador de Carga',
  'osc':'Operador de Sonda','moc':'Motorista de Convés'
};

const FUNCOES_MARITIMAS=[
  'CLC','CCB','1ON','2ON','MCB','CTR','MNC','MOC','MAC',
  'OSM','1OM','2OM','CDM','ELT','MNM','MOM','MAM',
  'CZR','TAA','ENF',
  'IST','Tec Mec','Tec Lab','OPC','HA','Rigger','BCO','Sup Carg',
  'Sup Merg','Cargo Tech','OGD','TST','Mont And','BBD','Mec',
  'Sold','Cald','Tec Plan','Mooring Master','ROP'
];

// Matriz SBM
const MATRIZ_SBM={
  eliminatorios_sempre:['CBSP','THUET','CA-EBS'],
  eliminatorios_se_exigido:['GMDSS'],
  criticos_hunters_nao_fornece:['NR-10','NR-37','NR-13','Scaffold Inspection','Leak Testing','Advanced Fire Fighting','Advanced Tanker Cargo Operations'],
  hunters_fornece:['NR-33','NR-35'],
  pmsi_obrigatorio_nao_eliminatorio:true
};

// ── Helpers de data / validade ───────────────────────────────────────────────
function detectarTipoCert(nomeCert){
  if(!nomeCert) return null;
  const n=nomeCert.toUpperCase();
  for(const chave of Object.keys(VALIDADE_CERT)){
    if(n.includes(chave.replace('-HOMOLOGADO','').replace('-PROVISORIO',''))) return chave;
  }
  return null;
}

function calcularValidade(dataEmissao, tipoCert, temCarimboMarinha){
  let dias=null;
  if(tipoCert==='CBSP'||tipoCert==='CBSP-HOMOLOGADO'||tipoCert==='CBSP-PROVISORIO'){
    dias=temCarimboMarinha ? VALIDADE_CERT['CBSP-HOMOLOGADO'] : VALIDADE_CERT['CBSP-PROVISORIO'];
  } else {
    dias=VALIDADE_CERT[tipoCert]||null;
  }
  if(!dias||!dataEmissao) return null;
  const d=new Date(dataEmissao);
  d.setDate(d.getDate()+dias);
  return d;
}

function certificadoValido(dataValidade){
  if(!dataValidade) return null;
  return new Date(dataValidade)>new Date();
}

// ── Chamada Anthropic ────────────────────────────────────────────────────────
async function chamarClaude(mensagens, systemPrompt){
  const resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1500,system:systemPrompt,messages:mensagens})
  });
  const data=await resp.json();
  return data.content?.[0]?.text||'';
}

// ── Transcrição de áudio ─────────────────────────────────────────────────────
async function transcreverAudio(audioBase64, mimeType){
  try{
    const audioBuffer=Buffer.from(audioBase64,'base64');
    const {Readable}=require('stream');
    const FormData=require('form-data');
    const form=new FormData();
    const stream=Readable.from(audioBuffer);
    const ext=mimeType.includes('ogg')?'ogg':mimeType.includes('mp4')?'mp4':'webm';
    form.append('file',stream,{filename:`audio.${ext}`,contentType:mimeType});
    form.append('model','whisper-1');
    form.append('language','pt');
    const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{...form.getHeaders(),'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:form
    });
    const d=await r.json();
    return d.text||null;
  }catch(e){console.error('Transcrição:',e.message);return null;}
}

// ── Leitura de imagem/PDF ────────────────────────────────────────────────────
async function lerDocumento(base64, mimeType){
  const isImagem=mimeType.startsWith('image/');
  const isPdf=mimeType==='application/pdf';
  if(!isImagem&&!isPdf) return null;
  try{
    const content=isImagem
      ? [{type:'image',source:{type:'base64',media_type:mimeType,data:base64}},
         {type:'text',text:`Analise este certificado/documento marítimo. Extraia em JSON:
{"tipo_cert":"nome do certificado","emissor":"empresa emissora","nome_titular":"nome completo","data_emissao":"DD/MM/AAAA ou AAAA-MM-DD","data_validade":"DD/MM/AAAA ou null","tem_carimbo_marinha":true/false,"funcao":"função se mencionada","observacoes":"qualquer info relevante"}
Responda APENAS o JSON, sem markdown.`}]
      : [{type:'text',text:`Documento PDF em base64: ${base64.substring(0,100)}... Extraia dados do certificado em JSON conforme instrução.`}];
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:800,messages:[{role:'user',content}]})
    });
    const data=await resp.json();
    const texto=data.content?.[0]?.text||'';
    const clean=texto.replace(/```json|```/g,'').trim();
    return JSON.parse(clean);
  }catch(e){console.error('Leitura doc:',e.message);return null;}
}

// ── Sistema de triagem Marina ────────────────────────────────────────────────
function systemPromptMarina(estado){
  return `Você é Marina, recrutadora virtual da Hunters Manpower — empresa especializada em mão de obra marítima e offshore com mais de 25 anos de história.

Seu estilo: profissional, cordial, objetiva. UMA pergunta por vez. Nunca liste tudo de uma vez.

Estado atual do candidato:
${JSON.stringify(estado,null,2)}

GLOSSÁRIO MARÍTIMO (use quando candidato perguntar):
${JSON.stringify(GLOSSARIO,null,2)}

FUNÇÕES RECONHECIDAS: ${FUNCOES_MARITIMAS.join(', ')}

REGRAS DE TRIAGEM:
1. Colete: nome completo, função desejada, certificados (peça para enviar fotos), experiência, disponibilidade, contato.
2. Para SBM: CBSP, THUET e CA-EBS são ELIMINATÓRIOS sempre. Informe gentilmente se o candidato não tiver.
3. Nunca elimine candidatos com nível STCW igual ou superior ao exigido na mesma cadeia (Convés ou Máquinas).
4. Ao final, se candidato apto, gere marcador oculto: [[APROVADO|nome=X|funcao=X|certificados=X|experiencia=X|disponibilidade=X|telefone=X]]
5. Se inapto, encerre com gentileza e incentive o candidato a buscar os certificados faltantes.
6. Se candidato indicar outro profissional: "Gostaria de abençoar alguém com essa vaga? Pode enviar meu contato ou me enviar o contato que eu mesmo ligo."
7. Mantenha tom positivo mesmo ao recusar.`;
}

// ── Processamento principal ──────────────────────────────────────────────────
async function processarMensagem(telefone, mensagemTexto, midiaBase64, midiaMime){
  if(!conversas[telefone]){
    conversas[telefone]={historico:[],estado:{etapa:'inicio',nome:null,funcao:null,certificados:[],experiencia:null,disponibilidade:null},iniciadoEm:new Date().toISOString()};
    await supaUpsert('triagens',{
      telefone,
      etapa:'inicio',
      dados:{},
      criado_em:new Date().toISOString(),
      atualizado_em:new Date().toISOString()
    },'telefone');
  }

  const conv=conversas[telefone];
  let textoFinal=mensagemTexto||'';

  // Áudio → transcrição
  if(midiaBase64&&midiaMime&&midiaMime.startsWith('audio/')){
    const transcricao=await transcreverAudio(midiaBase64,midiaMime);
    if(transcricao){
      textoFinal=transcricao;
      console.log(`Transcrição [${telefone}]: ${transcricao}`);
    } else {
      return 'Desculpe, não consegui entender o áudio. Pode digitar sua mensagem?';
    }
  }

  // Imagem/PDF → leitura de certificado
  if(midiaBase64&&midiaMime&&(midiaMime.startsWith('image/')||midiaMime==='application/pdf')){
    const dadosCert=await lerDocumento(midiaBase64,midiaMime);
    if(dadosCert){
      const tipo=detectarTipoCert(dadosCert.tipo_cert);
      const validade=calcularValidade(dadosCert.data_emissao,tipo,dadosCert.tem_carimbo_marinha);
      const valido=certificadoValido(validade||dadosCert.data_validade);
      dadosCert._validade_calculada=validade;
      dadosCert._valido=valido;
      conv.estado.certificados=conv.estado.certificados||[];
      conv.estado.certificados.push(dadosCert);
      textoFinal=`[Certificado enviado: ${dadosCert.tipo_cert||'documento'}. Emissor: ${dadosCert.emissor||'desconhecido'}. Válido: ${valido===true?'Sim':valido===false?'NÃO — VENCIDO':'indefinido'}]`;
      console.log(`Cert lido [${telefone}]:`,JSON.stringify(dadosCert));
    } else {
      textoFinal='[Imagem/documento enviado — não foi possível extrair dados automaticamente]';
    }
  }

  if(!textoFinal.trim()) return null;

  // Verificar glossário
  const textoLower=textoFinal.toLowerCase();
  for(const [sigla,descricao] of Object.entries(GLOSSARIO)){
    if(textoLower.includes(`o que é ${sigla}`)||textoLower.includes(`o que e ${sigla}`)){
      return `*${sigla.toUpperCase()}*: ${descricao}.`;
    }
  }

  conv.historico.push({role:'user',content:textoFinal});

  const resposta=await chamarClaude(conv.historico,systemPromptMarina(conv.estado));

  // Detectar aprovação
  if(resposta.includes('[[APROVADO|')){
    const match=resposta.match(/\[\[APROVADO\|(.+?)\]\]/);
    if(match){
      const dadosBrutos=match[1];
      const campos={};
      dadosBrutos.split('|').forEach(p=>{const i=p.indexOf('=');if(i>0){campos[p.slice(0,i).trim().toLowerCase()]=p.slice(i+1).trim();}});
      conv.estado.etapa='aprovado';
      if(campos.nome) conv.estado.nome=campos.nome;
      if(campos.funcao) conv.estado.funcao=campos.funcao;
      await supaInsert('candidatos_aprovados',{
        telefone,
        nome:campos.nome||conv.estado.nome||null,
        funcao:campos.funcao||conv.estado.funcao||null,
        certificados:campos.certificados||null,
        experiencia:campos.experiencia||null,
        disponibilidade:campos.disponibilidade||null,
        resumo_completo:dadosBrutos,
        aprovado_em:new Date().toISOString()
      });
      await supaUpdate('triagens',{telefone},{
        etapa:'aprovado',
        nome:campos.nome||null,
        funcao:campos.funcao||null,
        dados:campos,
        atualizado_em:new Date().toISOString()
      });
      await enviarAprovadoParaGrupo(dadosBrutos,telefone);
    }
    const respostaLimpa=resposta.replace(/\[\[APROVADO\|.+?\]\]/g,'').trim();
    conv.historico.push({role:'assistant',content:respostaLimpa});
    return respostaLimpa;
  }

  if(conv.historico.length%3===0){
    await supaUpdate('triagens',{telefone},{
      etapa:conv.estado.etapa||'em_andamento',
      nome:conv.estado.nome||null,
      funcao:conv.estado.funcao||null,
      dados:conv.estado,
      atualizado_em:new Date().toISOString()
    });
  }

  conv.historico.push({role:'assistant',content:resposta});
  return resposta;
}

// ── Envio WhatsApp ───────────────────────────────────────────────────────────
async function enviarWA(telefone,mensagem){
  try{
    await fetch(`${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},body:JSON.stringify({number:telefone,text:mensagem})});
  }catch(e){console.error('Erro WA:',e);}
}

async function enviarAprovadoParaGrupo(dadosBrutos,telefoneCandidato){
  if(!process.env.GRUPO_ID){console.error('GRUPO_ID não configurado.');return;}
  if(telefoneCandidato&&aprovadosEnviados[telefoneCandidato]){return;}
  if(telefoneCandidato) aprovadosEnviados[telefoneCandidato]=true;
  const campos={};
  dadosBrutos.split('|').forEach(p=>{const i=p.indexOf('=');if(i>0){campos[p.slice(0,i).trim().toLowerCase()]=p.slice(i+1).trim();}});
  const telefone=telefoneCandidato||campos.telefone||'—';
  const resumo=`🚢 *NOVO CANDIDATO APROVADO*\n\nNome: ${campos.nome||'—'}\nTelefone: ${telefone}\nFunção: ${campos.funcao||'—'}\nCertificados: ${campos.certificados||'—'}\nExperiência: ${campos.experiencia||'—'}\nDisponibilidade: ${campos.disponibilidade||'—'}`;
  try{
    await fetch(`${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},body:JSON.stringify({number:process.env.GRUPO_ID,text:resumo})});
    console.log(`Aprovado enviado ao grupo: ${campos.nome||telefone}`);
  }catch(e){console.error('Erro grupo:',e);}
}

// ── Webhook Evolution API ────────────────────────────────────────────────────
app.post('/webhook',(req,res)=>{
  res.sendStatus(200);
  setImmediate(async()=>{
    try{
      const body=req.body;

      // ✅ CORREÇÃO v3.9.1: aceitar evento em qualquer capitalização
      console.log('PAYLOAD:', JSON.stringify(body).substring(0,600));
      const evento=(body?.event||'').toUpperCase().replace('.','_');
      console.log(`Evento: ${evento}`);
      if(evento!=='MESSAGES_UPSERT'){console.log('IGNORADO_EVENTO');return;}
      const msg=body?.data?.messages?.[0]||body?.data?.message;
      console.log('MSG:', JSON.stringify(msg||null).substring(0,200));
      if(!msg){console.log('MSG_NULA');return;}
      if(msg.key?.fromMe){console.log('FROM_ME');return;}
      const remoteJid=msg.key?.remoteJid||'';
      const telefone=remoteJid.replace('@s.whatsapp.net','').replace('@g.us','');
      console.log('TELEFONE:', telefone, 'JID:', remoteJid);
      if(!telefone){console.log('SEM_TELEFONE');return;}
      if(remoteJid.includes('@g.us')){console.log('GRUPO');return;}
      const numeroMarina=(process.env.NUMERO_MARINA||'').replace(/\D/g,'');
      if(telefone===numeroMarina){console.log('MARINA_SELF');return;}
      let texto=msg.message?.conversation||msg.message?.extendedTextMessage?.text||'';
      let midiaBase64=null;
      let midiaMime=null;

      // Áudio
      const audioMsg=msg.message?.audioMessage||msg.message?.pttMessage;
      if(audioMsg){
        midiaMime=audioMsg.mimetype||'audio/ogg';
        const mediaData=body?.data?.media||body?.media;
        if(mediaData) midiaBase64=mediaData;
      }

      // Imagem
      const imagemMsg=msg.message?.imageMessage;
      if(imagemMsg){
        midiaMime=imagemMsg.mimetype||'image/jpeg';
        const mediaData=body?.data?.media||body?.media;
        if(mediaData) midiaBase64=mediaData;
      }

      // Documento
      const docMsg=msg.message?.documentMessage;
      if(docMsg){
        midiaMime=docMsg.mimetype||'application/pdf';
        const mediaData=body?.data?.media||body?.media;
        if(mediaData) midiaBase64=mediaData;
      }

      if(!texto&&!midiaBase64) return;

      console.log(`Mensagem de ${telefone}: ${texto||'[mídia]'}`);
      const resposta=await processarMensagem(telefone,texto,midiaBase64,midiaMime);
      if(resposta) await enviarWA(telefone,resposta);
    }catch(e){console.error('Erro webhook:',e);}
  });
});

// ── Endpoint de consulta para o app ─────────────────────────────────────────
app.get('/candidatos', async(req,res)=>{
  const senha=req.headers['x-app-senha']||req.query.senha;
  if(senha!==process.env.APP_SENHA){return res.status(401).json({erro:'Não autorizado'});}
  try{
    const rA=await fetch(`${SUPA_URL}/rest/v1/candidatos_aprovados?select=*&order=aprovado_em.desc`,{headers:{'apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`}});
    const rT=await fetch(`${SUPA_URL}/rest/v1/triagens?select=*&order=atualizado_em.desc`,{headers:{'apikey':SUPA_KEY,'Authorization':`Bearer ${SUPA_KEY}`}});
    res.json({aprovados:await rA.json(),triagens:await rT.json()});
  }catch(e){res.status(500).json({erro:e.message});}
});

// ── Login ────────────────────────────────────────────────────────────────────
app.post('/login',(req,res)=>{
  const {senha}=req.body||{};
  if(senha&&senha===process.env.APP_SENHA){res.json({ok:true});}
  else{res.status(401).json({ok:false});}
});

// ── Proxy Claude (para o app) ────────────────────────────────────────────────
app.post('/claude',async(req,res)=>{
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify(req.body)
    });
    const d=await r.json();
    res.json(d);
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Status ───────────────────────────────────────────────────────────────────
app.get('/',(req,res)=>{
  res.json({status:'Hunters Manpower Webhook ativo!',versao:'3.9.1',supabase:!!SUPA_URL});
});

const PORT=process.env.PORT||3001;
app.listen(PORT,()=>console.log(`Webhook v3.9.1 rodando na porta ${PORT}`));
