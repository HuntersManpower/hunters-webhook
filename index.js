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
// ── Verificação do Webhook (Meta) ────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'hunters2026';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFICADO_META');
    res.status(200).send(challenge);
  } else {
    console.log('WEBHOOK_VERIFICACAO_FALHOU', { mode, token });
    res.sendStatus(403);
  }
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
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1500,system:systemPrompt,messages:mensagens})
    });
    const data=await resp.json();
    if(!resp.ok||!data.content?.[0]?.text){
      console.error('chamarClaude falhou — status:',resp.status,'resposta:',JSON.stringify(data).substring(0,500));
    }
    return data.content?.[0]?.text||'';
  }catch(e){
    console.error('chamarClaude exceção:',e.message);
    return '';
  }
}
// ── Transcrição de áudio ─────────────────────────────────────────────────────
async function transcreverAudio(audioBase64, mimeType){
  try{
    const audioBuffer=Buffer.from(audioBase64,'base64');
    const ext=mimeType.includes('ogg')?'ogg':mimeType.includes('mp4')?'mp4':'webm';
    const form=new FormData();
    const blob=new Blob([audioBuffer],{type:mimeType});
    form.append('file',blob,`audio.${ext}`);
    form.append('model','whisper-1');
    form.append('language','pt');
    const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:form
    });
    const d=await r.json();
    if(!d.text){console.error('Transcrição sem texto — resposta Whisper:',JSON.stringify(d).substring(0,300));}
    return d.text||null;
  }catch(e){console.error('Transcrição:',e.message);return null;}
}
// ── Leitura de imagem/PDF ────────────────────────────────────────────────────
async function lerDocumento(base64, mimeType){
  const isImagem=mimeType.startsWith('image/');
  const isPdf=mimeType==='application/pdf';
  if(!isImagem&&!isPdf) return null;
  try{
    const instrucao=`Extraia os dados deste certificado marítimo. Retorne SOMENTE o JSON abaixo preenchido, sem texto antes, sem texto depois, sem markdown:
{"tipo_cert":"nome do certificado","emissor":"empresa emissora","nome_titular":"nome completo","data_emissao":"DD/MM/AAAA","data_validade":"DD/MM/AAAA ou null","tem_carimbo_marinha":false,"funcao":null,"observacoes":null}`;
    const content=isImagem
      ? [{type:'image',source:{type:'base64',media_type:mimeType,data:base64}},{type:'text',text:instrucao}]
      : [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:instrucao}];
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:800,messages:[{role:'user',content}]})
    });
    const data=await resp.json();
    const texto=data.content?.[0]?.text||'';
    console.log('Resposta lerDocumento:', texto.substring(0,200));
    // Extrair JSON mesmo que venha com texto ao redor
    const match=texto.match(/\{[\s\S]*\}/);
    if(!match) throw new Error('JSON não encontrado na resposta');
    return JSON.parse(match[0]);
  }catch(e){console.error('Leitura doc:',e.message);return null;}
}
// ── Sistema de triagem Marina ────────────────────────────────────────────────
function systemPromptMarina(estado){
  const hoje=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  return `Você é Marina, recrutadora virtual da Hunters Manpower — empresa especializada em mão de obra marítima e offshore com mais de 25 anos de história.
Seu estilo: profissional, cordial, objetiva. UMA pergunta por vez. Nunca liste tudo de uma vez.
⚠️ DATA DE HOJE: ${hoje} — use esta data para verificar se certificados estão válidos ou vencidos.
Estado atual do candidato:
${JSON.stringify(estado,null,2)}
═══════════════════════════════════════════════
FUNÇÕES MARÍTIMAS E OFFSHORE — GLOSSÁRIO COMPLETO
═══════════════════════════════════════════════
NÁUTICA / CONVÉS (cadeia STCW Convés):
- CLC = Capitão de Longo Curso (comando máximo de embarcações de longo curso — STCW II/2)
- CCB = Capitão de Cabotagem (comando em cabotagem — STCW II/2)
- 1ON = Primeiro Oficial de Náutica (imediato — STCW II/1 ou II/2)
- 2ON = Segundo Oficial de Náutica (STCW II/1, II/2 ou II/3 dependendo do navio)
- MCB = Mestre de Cabotagem (STCW II/3 ou II/4)
- CTR = Contramestre / Bosun (STCW II/4 ou II/3 — CTR TEM STCW)
- MNC = Marinheiro de Náutica / Convés (sem STCW obrigatório)
- MOC = Motorista de Convés (sem STCW obrigatório)
- MAC = Marinheiro Auxiliar de Convés
MÁQUINAS (cadeia STCW Máquinas — SEPARADA da convés):
- OSM = Oficial Superior de Máquinas / Chefe de Máquinas (STCW III/2)
- 1OM = Primeiro Oficial de Máquinas (STCW III/1 ou III/2)
- 2OM = Segundo Oficial de Máquinas (STCW III/1, III/2 ou III/3)
- CDM = Condutor de Máquinas (STCW III/3 ou III/7)
- ELT = Eletricista de Bordo
- MNM = Marinheiro de Náutica de Máquinas
- MOM = Motorista de Máquinas
- MAM = Marinheiro Auxiliar de Máquinas
SAÚDE / OUTROS A BORDO:
- CZR = Cozinheiro de Bordo
- TAA = Taifeiro / Auxiliar de Câmara
- ENF = Enfermeiro de Bordo
OFFSHORE / PLATAFORMAS:
- IST = Inspetor de Equipamentos
- Tec Mec = Técnico de Mecânica
- Tec Lab = Técnico de Laboratório
- OPC = Operador de Produção / Campo
- HA = Helicóptero Administrador
- Rigger = Operador de Guindaste / Aparelhador
- BCO = Ballast Control Operator / Supervisor de Carga (JD10 na SBM) — é FUNÇÃO, NUNCA certificado
- Sup Carg = Supervisor de Carga (mesmo que BCO em contexto offshore)
- Sup Merg = Supervisor de Mergulho
- Cargo Tech = Técnico de Carga
- OGD = Operador de Guindaste Dinâmico
- TST = Técnico de Segurança do Trabalho
- Mont And = Montador de Andaime
- BBD = Bombeiro de Bordo
- Mec = Mecânico
- Sold = Soldador
- Cald = Caldeireiro
- Tec Plan = Técnico de Planejamento
- Mooring Master = Mestre de Manobra
- ROP = Responsável de Operação de Plataforma
- Operador de Carga (JD31) = Bombeador / Pumpman (cadeia Máquinas, STCW III/4)
TERMINOLOGIA OFFSHORE:
- FPSO = Floating Production Storage and Offloading
- PLSV = Pipe Laying Support Vessel
- ROV = Remotely Operated Vehicle
- DP = Dynamic Positioning
- DSV = Diving Support Vessel
═══════════════════════════════════════════════
HIERARQUIA STCW (NORMAM-13/DPC)
═══════════════════════════════════════════════
CADEIA CONVÉS: II/2 > II/1 > II/3 > II/4
CADEIA MÁQUINAS: III/2 > III/1 > III/3 = III/7
As cadeias são SEPARADAS — convés não substitui máquinas e vice-versa.
REGRAS STCW:
- Aprove quem tem nível IGUAL OU SUPERIOR na MESMA cadeia
- 2OM pode ter III/1, III/2 ou III/3 — rankeie pelo certificado apresentado, nunca fixe pelo cargo
- CTR TEM STCW (II/3 ou II/4)
- BCO/Supervisor de Carga: mínimo STCW II/2
- Pumpman/Operador de Carga (JD31): CIR de CDM + STCW III/4
═══════════════════════════════════════════════
CERTIFICADOS — VALIDADES
═══════════════════════════════════════════════
- CBSP homologado (com carimbo da Marinha): 5 anos
- CBSP provisório (sem carimbo da Marinha): 90 dias
- THUET (OPITO): 4 anos | Emissoras autorizadas: RelyOn Nutec, West Group, FCO Offshore
- CA-EBS: 5 anos
- GMDSS / CIR: 5 anos
- STCW: 5 anos
- NR-37: 5 anos | NR-35: 2 anos | NR-10: 2 anos
- NR-33: 1 ano | NR-23: 1 ano | NR-05: 1 ano | NR-36: 1 ano | NR-34 Estanqueidade: 1 ano
═══════════════════════════════════════════════
MATRIZ SBM OFFSHORE
═══════════════════════════════════════════════
Observação: CBSP e THUET são os críticos de embarque (aparecem em toda função). CA-EBS é eliminatório SEMPRE — NUNCA diga que é "só para equipe de emergência". PMSI é treinamento interno online da SBM, feito antes do embarque — obrigatório, mas NUNCA eliminatório.
CRÍTICOS — Hunters NÃO fornece (avisar com urgência):
→ NR-10, NR-37, NR-13 A/B, Inspeção de Andaime, Estanqueidade, Combate a Incêndio Avançado, Operações Avançadas de Carga em Petroleiros
HUNTERS FORNECE (tranquilizar o candidato):
→ NR-33, NR-35
CERTIFICAÇÕES OBRIGATÓRIAS (X) E CONDICIONAIS (C) POR FUNÇÃO — identifique a função do candidato e cobre TODOS os itens X como eliminatórios. Itens C só eliminam se a vaga específica exigir (pergunte se não estiver claro). Se a função não estiver na lista, aplique o fallback: CBSP + THUET + CA-EBS sempre, GMDSS se a vaga exigir.
• Técnico de Laboratório (JD21): X = CBSP, NR33 Entrada Espaço Confinado (16h), NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = nenhum. Experiência: formação em Química, 2 anos como Téc. de Laboratório em processamento de hidrocarbonetos (FPSO de preferência).
• 2º Oficial de Máquinas / Operador de Manutenção (JD32): X = CBSP, NR33 (16h), NR-35, NR-13 Caldeiras (Anexo I-A), NR-13 Vasos de Pressão (Anexo I-B), NR-34 Estanqueidade, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = nenhum. Experiência: 3 anos embarcado em máquinas (STCW A-III/4 ou EOOW A-III/1), solda/ajuste, VLCC ou FPSO desejável.
• Técnico de Elétrica (JD24): X = CBSP, NR33 (16h), NR-35, NR-10 Básico, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = nenhum. Experiência: ONC/HNC/NVQ Nível 3 em Manutenção Elétrica, mín. 5 anos (2 offshore desejável), COMP-EX.
• Técnico de Instrumentação (JD25): X = CBSP, NR33 (16h), NR-35, NR-10 Básico, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = nenhum. Experiência: N/SVQ/HNC/HND em Instrumentação, 3 anos (offshore de preferência), COMP-EX de preferência.
• Técnico de Mecânica (JD26): X = CBSP, NR33 (16h), NR-35, NR-13 Vasos de Pressão (Anexo I-B), NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = MCIA (Helideck). Experiência: N/SVQ/HNC/HND em Mecânica, 3 anos (offshore de preferência).
• Almoxarife (JD28): X = CBSP, NR33 (16h), NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = Mercadorias Perigosas via Aérea, Mercadorias Perigosas por Mar (IMDG). Experiência: 3 anos na indústria marítima/petróleo (FPSO de preferência), sistemas de inventário em PC.
• Assistente de Almoxarife (JD38): X = CBSP, NR33 (16h), NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = Mercadorias Perigosas via Aérea, Mercadorias Perigosas por Mar (IMDG). Experiência: 1 ano na indústria marítima/petróleo (FPSO de preferência).
• Supervisor de Carga / BCO (JD10): X = CBSP, Combate a Incêndio Avançado, Curso Avançado Operações de Carga em Petroleiros, Proficiência em Deveres de Segurança Designados, NR33 Supervisor de Espaço Confinado (40h), Rigging NR-37/NR-34, NR-35, NR-34 Estanqueidade, NR-37 Básico, NR-37 Avançado, Certificação BCO (Ballast Control Operator), THUET, CA-EBS. C = CESS. Requer também STCW mínimo II/2 + CIR. Experiência: STCW II/2 (Imediato ≥3000 GT), 3 anos em petroleiros de óleo cru (VLCC de preferência) como OOW, FPSO uma vantagem.
• Operador de Carga / Pumpman (JD31): X = CBSP, Curso Básico Operações de Carga em Navios-Tanque, NR33 (16h), Rigging NR-37/NR-34, NR-35, NR-34 Estanqueidade, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = CESS. Requer também CIR de CDM + STCW III/4. Experiência: 3 anos como Bombeador (Pumpman) em petroleiros (VLCC de preferência), STCW A-II/4.
• Mestre de Cabotagem / Contramestre (JD34): X = CBSP, Proficiência em Deveres de Segurança Designados, NR33 (16h), Rigging NR-37/NR-34, NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = CESS, Mercadorias Perigosas via Aérea, MCIA (Helideck), Mercadorias Perigosas por Mar (IMDG). Experiência: STCW A-II/4 mínimo, 5 anos em navios oceânicos (2+ como Contramestre em petroleiros, VLCC de preferência).
• Marinheiro de Convés / MCB / MNC (JD36): X = CBSP, NR33 (16h), Rigging NR-37/NR-34, NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = CESS, Mercadorias Perigosas via Aérea, MCIA, Mercadorias Perigosas por Mar (IMDG). Requer também CIR. Experiência: mais de 2 anos em função de convés (offshore ou marítimo), STCW A-II/5.
• Homem de Área (JD-GP): X = CBSP, NR33 (16h), Rigging NR-37/NR-34, NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = CESS, Mercadorias Perigosas via Aérea, MCIA, Mercadorias Perigosas por Mar (IMDG). Experiência: ensino fundamental completo, inglês básico, mín. 1 ano comprovado em movimentação de carga offshore.
• Operador de Guindaste (JD35): X = CBSP, Proficiência em Deveres de Segurança Designados, NR33 (16h), Rigging NR-37/NR-34, Curso Complementar Operador de Guindaste NR-37, NR-35, NR-37 Básico, NR-37 Avançado, THUET, Operações de Guindaste Offshore Nível 3, CA-EBS. C = Mercadorias Perigosas via Aérea, MCIA, Mercadorias Perigosas por Mar (IMDG). Experiência: Operação de Guindaste Nível 3, experiência offshore em guindaste/rigging/convés, STCW A-II/4 de preferência.
• Técnico de Segurança (JD7): X = CBSP, Combate a Incêndio Avançado, NR33 Supervisor (40h), Rigging NR-37/NR-34, Inspeção de Andaime NR-34, NR-35, NR-34 Estanqueidade, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = Mercadorias Perigosas via Aérea, MCIA, Mercadorias Perigosas por Mar (IMDG). Experiência: NEBOSH Cert mínimo (Diploma uma vantagem), 5 anos em produção de hidrocarbonetos ou como Téc. de Segurança, FPSO de preferência.
• Técnico de Segurança Assistente (JD8): X = CBSP, NR33 (16h), Rigging NR-37/NR-34, Inspeção de Andaime NR-34, NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = Mercadorias Perigosas via Aérea, MCIA, Mercadorias Perigosas por Mar (IMDG). Experiência: manutenção de FFE/LSA, operações de helicóptero, FPSO de preferência.
• Operador de Rádio / ROP (JD29): X = CBSP, Curso de Radioperador GMDSS, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = NR-35. Experiência: qualificação em radiooperações ou STCW A-IV/2, Excel/Word, manutenção de telecom desejável.
• Operador de Produção (JD30): X = CBSP, NR33 (16h), NR-35, NR-37 Básico, NR-37 Avançado, THUET, CA-EBS. C = nenhum. Experiência: N/SVQ Processamento de Hidrocarbonetos Nível 2, 2 anos em processo/utilidades, conhecimento de ESD/F&G/DCS.
═══════════════════════════════════════════════
REGRAS DE ANÁLISE DE DOCUMENTOS
═══════════════════════════════════════════════
- NUNCA aceite data que o candidato apenas digitou ou falou — peça sempre a FOTO
- NUNCA invente validade — se não conseguir ler a data, peça foto mais clara
- Use a data de validade impressa no documento; só calcule se não houver validade impressa
- CBSP provisório vencido (mais de 90 dias): informar que precisa do homologado
- Foto ilegível: pedir nova foto com boa iluminação, sem reflexo, documento plano
- Emissora desconhecida (THUET): aceitar provisoriamente + alertar + pedir onde fez o curso
═══════════════════════════════════════════════
REGRAS DE TRIAGEM
═══════════════════════════════════════════════
1. Colete em ordem: nome completo → função → certificados (fotos) → experiência → disponibilidade
2. UMA pergunta por vez
3. Candidato inapto: encerre com gentileza, incentive a buscar certificados
4. Candidato apto: gere [[APROVADO|nome=X|funcao=X|certificados=X|experiencia=X|disponibilidade=X|telefone=X]]
5. Se candidato indicar outro: "Gostaria de abençoar alguém com essa vaga? Pode enviar meu contato ou me enviar o contato que eu mesmo ligo."
6. Falta de cortesia é eliminatória
7. VALORES DA HUNTERS: disponibilidade, educação, bom comportamento, inglês (oficiais), experiência e caráter`;
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
      const dataVenc=validade?validade.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):dadosCert.data_validade||'desconhecida';
      const statusValidade=valido===true?'VALIDO ate '+dataVenc:valido===false?'VENCIDO em '+dataVenc:'validade indefinida';
      textoFinal='[VEREDITO: '+( dadosCert.tipo_cert||'doc')+' | titular='+(dadosCert.nome_titular||'?')+'| emissor='+(dadosCert.emissor||'?')+'| emissao='+(dadosCert.data_emissao||'?')+'| carimbo='+(dadosCert.tem_carimbo_marinha)+'| STATUS='+statusValidade+']';
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
      await supaUpsert('candidatos_aprovados',{
        telefone,
        nome:campos.nome||conv.estado.nome||null,
        funcao:campos.funcao||conv.estado.funcao||null,
        certificados:campos.certificados||null,
        experiencia:campos.experiencia||null,
        disponibilidade:campos.disponibilidade||null,
        resumo_completo:dadosBrutos,
        aprovado_em:new Date().toISOString()
      },'telefone');
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
    console.log(`enviarWA → ${telefone}: "${mensagem.substring(0,120)}"`);
    const r=await fetch(`${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},body:JSON.stringify({number:telefone,text:mensagem})});
    const d=await r.json().catch(()=>null);
    if(!r.ok){console.error('enviarWA FALHOU — status:',r.status,'resposta:',JSON.stringify(d).substring(0,400));}
    else{console.log('enviarWA OK — status:',r.status);}
  }catch(e){console.error('Erro WA:',e.message);}
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
      const msg=body?.data?.messages?.[0]||body?.data?.message||body?.data;
      console.log('MSG:', JSON.stringify(msg||null).substring(0,200));
      if(!msg){console.log('MSG_NULA');return;}
      const remoteJid=msg.key?.remoteJid||body?.data?.key?.remoteJid||'';
      const telefone=remoteJid.replace('@s.whatsapp.net','').replace('@g.us','');
      console.log('TELEFONE:', telefone, 'JID:', remoteJid);
      if(!telefone){console.log('SEM_TELEFONE');return;}
      if(remoteJid.includes('@g.us')){console.log('GRUPO');return;}
      const numeroMarina=(process.env.NUMERO_MARINA||'').replace(/\D/g,'');
      if(telefone===numeroMarina){console.log('MARINA_SELF');return;}
      const ehFromMe=msg.key?.fromMe||msg.fromMe||body?.data?.fromMe||body?.data?.key?.fromMe||false;
      if(ehFromMe){console.log('FROM_ME — mensagem enviada pelo próprio número, ignorando');return;}
      let texto=msg.message?.conversation||msg.message?.extendedTextMessage?.text||body?.data?.message?.conversation||body?.data?.message?.extendedTextMessage?.text||'';
      let midiaBase64=null;
      let midiaMime=null;
      // Função para baixar mídia via Evolution API
      async function baixarMidia(messageId){
        try{
          console.log('Tentando baixar mídia, messageId:', messageId);
          const r=await fetch(`${process.env.EVO_URL}/chat/getBase64FromMediaMessage/${process.env.EVO_INSTANCE}`,{
            method:'POST',
            headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},
            body:JSON.stringify({message:{key:{id:messageId,remoteJid:remoteJid,fromMe:false}}})
          });
          const d=await r.json();
          console.log('Resposta download mídia:', JSON.stringify(d).substring(0,200));
          return d?.base64||d?.data?.base64||d?.mediaUrl||null;
        }catch(e){console.error('Erro download mídia:',e.message);return null;}
      }
      const messageId=msg.key?.id||body?.data?.key?.id||'';
      console.log('messageId:', messageId);
      // Áudio
      const audioMsg=msg.message?.audioMessage||msg.message?.pttMessage||body?.data?.message?.audioMessage||body?.data?.message?.pttMessage;
      if(audioMsg){
        midiaMime=audioMsg.mimetype||'audio/ogg';
        console.log('audioMsg detectado, mimetype:', midiaMime, 'messageId:', messageId);
        midiaBase64=body?.data?.media||body?.media||await baixarMidia(messageId);
        console.log('Áudio base64 obtido:', midiaBase64?'SIM ('+midiaBase64.length+' chars)':'NÃO');
        if(!midiaBase64){
          console.log('Áudio não baixado — avisando candidato');
          await enviarWA(telefone,'Recebi seu áudio, mas não consegui processá-lo agora. Pode tentar reenviar ou escrever a mensagem em texto, por favor? 🙏');
          return;
        }
      }
      // Imagem
      const imagemMsg=msg.message?.imageMessage||body?.data?.message?.imageMessage;
      if(imagemMsg){
        midiaMime=imagemMsg.mimetype||'image/jpeg';
        console.log('imagemMsg detectado, mimetype:', midiaMime, 'messageId:', messageId);
        midiaBase64=body?.data?.media||body?.media||await baixarMidia(messageId);
        console.log('Imagem base64 obtida:', midiaBase64?'SIM ('+midiaBase64.length+' chars)':'NÃO');
        if(!midiaBase64){
          console.log('Imagem não baixada — avisando candidato');
          await enviarWA(telefone,'Recebi sua imagem, mas não consegui processá-la agora. Pode tentar reenviar, por favor? 🙏');
          return;
        }
      }
      // Documento (PDF)
      const docMsg=msg.message?.documentMessage||body?.data?.message?.documentMessage;
      if(docMsg){
        midiaMime=docMsg.mimetype||'application/pdf';
        console.log('docMsg detectado, mimetype:', midiaMime, 'messageId:', messageId);
        midiaBase64=body?.data?.media||body?.media||await baixarMidia(messageId);
        console.log('PDF base64 obtido:', midiaBase64?'SIM ('+midiaBase64.length+' chars)':'NÃO');
        if(!midiaBase64){
          console.log('PDF não baixado — pedindo foto ao candidato');
          await enviarWA(telefone,'Recebi seu documento! 📄 Para garantir a leitura correta, pode me enviar também como *foto* ou *imagem*? Fica mais fácil de visualizar os dados. 😊');
          return;
        }
      }
      if(!texto&&!midiaBase64) return;
      console.log(`Mensagem de ${telefone}: ${texto||'[mídia]'}`);
      const resposta=await processarMensagem(telefone,texto,midiaBase64,midiaMime);
      console.log('processarMensagem retornou:', resposta?`"${resposta.substring(0,150)}"`:'(vazio/null — nada será enviado)');
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
