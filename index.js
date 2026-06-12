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
const aprovadosEnviados = {}; // trava: evita enviar o mesmo candidato 2x ao grupo

// Certificados com validade de 5 anos
const VALIDADE_5_ANOS = ['CBSP','THUET','CIR','STCW'];

// ===== EMISSORAS AUTORIZADAS POR CERTIFICADO =====
const EMISSORAS_AUTORIZADAS = {
  THUET: {
    tipo: "OPITO (Offshore Petroleum Industry Training Organisation)",
    campo_validador: "OPITO UCN",
    empresas: ["RelyOn Nutec","West Group","FCO Offshore"]
    // ATENÇÃO: ao receber modelos da West Group e FCO, adicionar descrição visual aqui
  },
  CBSP: {
    tipo: "DPC/Marinha do Brasil (NORMAM-104)",
    empresas_conhecidas: [
      "Lighthouse-SMS","FAT Assessoria","RelyOn Nutec","West Group",
      "FCO Offshore","Shelter","IPETEC","JJR Solutions","ATAC Fire",
      "Alternativa Brigadas","A. Reinaldo","Centro Educacional Manoel Lopes"
    ]
  }
};

// Verifica se a emissora do certificado é autorizada.
// Retorna { valido, alerta, acao }
function validarEmissoraCertificado(tipoCert, nomeEmissora){
  if(!tipoCert || !nomeEmissora) return { valido: true, alerta: null, acao: 'aceitar' };
  const tipo = tipoCert.toUpperCase();
  const emissora = nomeEmissora.toLowerCase();

  if(tipo === 'THUET'){
    const autorizada = EMISSORAS_AUTORIZADAS.THUET.empresas.some(e =>
      emissora.includes(e.toLowerCase().split(' ')[0])
    );
    if(!autorizada){
      return {
        valido: false,
        alerta: `⚠️ THUET emitido por empresa não identificada como credenciada OPITO no Brasil (${nomeEmissora}). Emissoras autorizadas: RelyOn Nutec, West Group e FCO Offshore. Verificar presença do código OPITO UCN no certificado.`,
        acao: 'solicitar_foto_melhor_e_perguntar_onde_fez'
      };
    }
    return { valido: true, alerta: null, acao: 'aceitar' };
  }

  if(tipo === 'CBSP'){
    const conhecida = EMISSORAS_AUTORIZADAS.CBSP.empresas_conhecidas.some(e =>
      emissora.includes(e.toLowerCase().split(' ')[0])
    );
    if(!conhecida){
      return {
        valido: null,
        alerta: `⚠️ CBSP emitido por empresa não listada como credenciada DPC conhecida (${nomeEmissora}). Aceito provisoriamente — verificar homologação.`,
        acao: 'aceitar_com_alerta_e_perguntar_onde_fez'
      };
    }
    return { valido: true, alerta: null, acao: 'aceitar' };
  }

  return { valido: true, alerta: null, acao: 'aceitar' };
}

// ===== MATRIZ DE TREINAMENTOS SBM OFFSHORE =====
const ELIM_SEMPRE = ["CBSP","THUET","CAEBS"];
const ELIM_SOLICITADO = ["GMDSS","BCO"];

const CERT_NIVEL = {
  "CBSP":"ELIM_SEMPRE","AFF":"CRITICO","TANK_BAS":"PADRAO","TANK_ADV":"CRITICO",
  "CESS":"PADRAO","GMDSS":"ELIM_SOLICITADO","DG_AIR":"PADRAO","SECURITY":"PADRAO",
  "NR33_ENT":"LEVE","NR33_SUP":"LEVE","RIGGING":"PADRAO","CRANE_NR37":"PADRAO",
  "SCAFF":"CRITICO","NR35":"LEVE","HELIDECK":"PADRAO","NR13_BOIL":"CRITICO",
  "NR13_PV":"CRITICO","NR10":"CRITICO","LEAK_NR34":"CRITICO","NR37_BAS":"CRITICO",
  "NR37_ADV":"CRITICO","DG_SEA":"PADRAO","MAINT_SUP":"PADRAO","BARGE_SUP":"PADRAO",
  "BCO":"ELIM_SOLICITADO","ACLS":"PADRAO","ATLS":"PADRAO","THUET":"ELIM_SEMPRE",
  "CRANE_L3":"PADRAO","CAEBS":"ELIM_SEMPRE","PMSI":"PADRAO",
};

const CERT_NOMES = {
  "CBSP":"Curso Básico de Segurança de Plataforma (CBSP)",
  "AFF":"Combate a Incêndio Avançado",
  "TANK_BAS":"Curso Básico Operações de Carga em Navios-Tanque",
  "TANK_ADV":"Curso Avançado Operações de Carga em Petroleiros",
  "CESS":"CESS - Embarcações de Sobrevivência e Salvamento",
  "GMDSS":"Curso de Radioperador GMDSS",
  "DG_AIR":"Mercadorias Perigosas por via Aérea",
  "SECURITY":"Proficiência em Deveres de Segurança Designados",
  "NR33_ENT":"NR33 - Entrada em Espaço Confinado (16h)",
  "NR33_SUP":"NR33 - Supervisor de Espaço Confinado (40h)",
  "RIGGING":"Movimentação de Cargas (Rigging) NR-37/NR-34",
  "CRANE_NR37":"Curso Complementar Operador de Guindaste NR-37",
  "SCAFF":"Inspeção de Andaime NR34",
  "NR35":"NR-35 - Trabalho em Altura",
  "HELIDECK":"MCIA - Manobra e Combate a Incêndio de Aviação (Helideck)",
  "NR13_BOIL":"NR-13 - Operação de Caldeiras (Anexo I-A)",
  "NR13_PV":"NR-13 - Unidades de Processo / Vasos de Pressão (Anexo I-B)",
  "NR10":"NR-10 Básico (Segurança em Eletricidade)",
  "LEAK_NR34":"NR34 - Teste de Estanqueidade",
  "NR37_BAS":"NR-37 Básico",
  "NR37_ADV":"NR-37 Avançado",
  "DG_SEA":"Mercadorias Perigosas por Mar (IMDG)",
  "MAINT_SUP":"Certificação Supervisor de Manutenção",
  "BARGE_SUP":"Certificação Supervisor de Lastro",
  "BCO":"Certificação Operador de Controle de Lastro (BCO)",
  "ACLS":"ACLS - Suporte Avançado de Vida em Cardiologia",
  "ATLS":"ATLS - Suporte Avançado de Vida no Trauma",
  "THUET":"THUET (escape de helicóptero) - OPITO",
  "CRANE_L3":"Operações de Guindaste Offshore Nível 3",
  "CAEBS":"CA-EBS - Compressed Air Emergency Breathing System (OPITO)",
  "PMSI":"Vendor PMSI (treinamento interno SBM, online)",
};

const MARITIMO_FUNCAO = {
  "Supervisor de Carga":["CIR (1º Of. Náutica ou superior)","STCW II/2 (cadeia Convés)"],
  "Operador de Carga":["CIR de CDM","STCW III/4 (cadeia Máquinas)"],
  "Mestre de Cabotagem (Contramestre)":["CIR de MCB ou CTR","STCW A-II/4 (cadeia Convés)"],
  "Marinheiro de Convés":["CIR de MNC","STCW A-II/5 (cadeia Convés)"],
  "2º Oficial de Máquinas / Operador de Manutenção":["CIR (2º Of. Máquinas ou superior)","STCW III/1 (cadeia Máquinas)"],
};

const STCW_RANK = {
  CONVES:{
    "II/4":1,"A-II/4":1,"A-II/5":1,
    "II/3":2,
    "II/1":3,
    "II/2":4,
  },
  MAQUINAS:{
    "III/7":1,
    "III/3":2,"III/4":2,"A-III/4":2,
    "III/1":3,
    "III/2":4,
  }
};

function atendeStcw(cadeia, exigido, candidato){
  if(!exigido||!cadeia) return true;
  const rank = STCW_RANK[cadeia];
  if(!rank) return true;
  const rankExigido = rank[(exigido||'').trim().split(' ')[0].toUpperCase()];
  if(!rankExigido) return true;
  const niveis = Array.isArray(candidato)?candidato:[candidato];
  const melhor = niveis.reduce((max,nv)=>{
    const r = rank[(nv||'').trim().split(' ')[0].toUpperCase()];
    return r&&r>max?r:max;
  },0);
  return melhor>=rankExigido;
}

const MATRIZ_TREINAMENTOS = {
  "Técnico de Laboratório":{jd:"JD21",obrig:["CBSP","NR33_ENT","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:[]},
  "2º Oficial de Máquinas / Operador de Manutenção":{jd:"JD32",obrig:["CBSP","NR33_ENT","NR35","NR13_BOIL","NR13_PV","LEAK_NR34","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:[]},
  "Técnico de Elétrica":{jd:"JD24",obrig:["CBSP","NR33_ENT","NR35","NR10","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:[]},
  "Técnico de Instrumentação":{jd:"JD25",obrig:["CBSP","NR33_ENT","NR35","NR10","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:[]},
  "Técnico de Mecânica":{jd:"JD26",obrig:["CBSP","NR33_ENT","NR35","NR13_PV","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["HELIDECK"]},
  "Almoxarife":{jd:"JD28",obrig:["CBSP","NR33_ENT","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["DG_AIR","DG_SEA"]},
  "Assistente de Almoxarife":{jd:"JD38",obrig:["CBSP","NR33_ENT","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["DG_AIR","DG_SEA"]},
  "Supervisor de Carga":{jd:"JD10",obrig:["CBSP","AFF","TANK_ADV","SECURITY","NR33_SUP","RIGGING","NR35","LEAK_NR34","NR37_BAS","NR37_ADV","BCO","THUET","CAEBS","PMSI"],cond:["CESS"]},
  "Operador de Carga":{jd:"JD31",obrig:["CBSP","TANK_BAS","NR33_ENT","RIGGING","NR35","LEAK_NR34","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["CESS"]},
  "Mestre de Cabotagem (Contramestre)":{jd:"JD34",obrig:["CBSP","SECURITY","NR33_ENT","RIGGING","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["CESS","DG_AIR","HELIDECK","DG_SEA"]},
  "Marinheiro de Convés":{jd:"JD36",obrig:["CBSP","NR33_ENT","RIGGING","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["CESS","DG_AIR","HELIDECK","DG_SEA"]},
  "Homem de Área":{jd:"JD-GP",obrig:["CBSP","NR33_ENT","RIGGING","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["CESS","DG_AIR","HELIDECK","DG_SEA"]},
  "Operador de Guindaste":{jd:"JD35",obrig:["CBSP","SECURITY","NR33_ENT","RIGGING","CRANE_NR37","NR35","NR37_BAS","NR37_ADV","THUET","CRANE_L3","CAEBS","PMSI"],cond:["DG_AIR","HELIDECK","DG_SEA"]},
  "Técnico de Segurança":{jd:"JD7",obrig:["CBSP","AFF","NR33_SUP","RIGGING","SCAFF","NR35","LEAK_NR34","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["DG_AIR","HELIDECK","DG_SEA"]},
  "Técnico de Segurança (Assistente)":{jd:"JD8",obrig:["CBSP","NR33_ENT","RIGGING","SCAFF","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["DG_AIR","HELIDECK","DG_SEA"]},
  "Operador de Rádio":{jd:"JD29",obrig:["CBSP","GMDSS","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:["NR35"]},
  "Operador de Produção":{jd:"JD30",obrig:["CBSP","NR33_ENT","NR35","NR37_BAS","NR37_ADV","THUET","CAEBS","PMSI"],cond:[]},
};

function mapearFuncaoSBM(textoFuncao){
  if(!textoFuncao) return null;
  const t = textoFuncao.toLowerCase();
  const regras = [
    [["guindast","crane","ogd"],"Operador de Guindaste"],
    [["mestre de cabotagem","contramestre","gp foreman","mcb"],"Mestre de Cabotagem (Contramestre)"],
    [["marinheiro de conv","gp operator ab","mnc","convés","conves"],"Marinheiro de Convés"],
    [["homem de área","homem de area"," ha","gp operator"],"Homem de Área"],
    [["supervisor de carga","cargo sup","sup carg","bco","ballast","controle de lastro"],"Supervisor de Carga"],
    [["operador de carga","cargo operator","bombeador","pumpman","bbd"],"Operador de Carga"],
    [["instrument","ist"],"Técnico de Instrumentação"],
    [["elétric","eletric","elt"],"Técnico de Elétrica"],
    [["mecân","mecan","tec mec"],"Técnico de Mecânica"],
    [["laborat","lab tech","tec lab"],"Técnico de Laboratório"],
    [["almoxarife assist","assistente de almox"],"Assistente de Almoxarife"],
    [["almoxarife","store keeper","storekeeper"],"Almoxarife"],
    [["assistente de segur","assistant safety"],"Técnico de Segurança (Assistente)"],
    [["segurança","seguranca","safety","tst"],"Técnico de Segurança"],
    [["rádio","radio","rop","gmdss"],"Operador de Rádio"],
    [["produção","producao","production operator","opc","utilidad"],"Operador de Produção"],
    [["manutenção","manutencao","maintenance operator","oficial de máquinas","oficial de maquinas","mom","2om"],"2º Oficial de Máquinas / Operador de Manutenção"],
  ];
  for(const [chaves,alvo] of regras){
    if(chaves.some(k=>t.includes(k))) return alvo;
  }
  return null;
}

function guiaMatriz(textoFuncao){
  const chave = mapearFuncaoSBM(textoFuncao);
  if(!chave||!MATRIZ_TREINAMENTOS[chave]) return '';
  const f = MATRIZ_TREINAMENTOS[chave];
  const nome = c => CERT_NOMES[c]||c;
  const grupos = {ELIM_SEMPRE:[],ELIM_SOLICITADO:[],CRITICO:[],LEVE:[],PADRAO:[]};
  (f.obrig||[]).forEach(c=>{
    const nv = CERT_NIVEL[c]||'PADRAO';
    (grupos[nv]=grupos[nv]||[]).push(nome(c));
  });
  const cond = (f.cond||[]).map(nome);
  const {ELIM_SEMPRE:elimSempre,ELIM_SOLICITADO:elimSolic,CRITICO:criticos,LEVE:leves,PADRAO:padrao} = grupos;
  const maritimo = MARITIMO_FUNCAO[chave]||[];

  let g = `\n\n[MATRIZ SBM — função reconhecida como "${chave}" (${f.jd}). Regras de certificado para esta vaga offshore SBM, por nível:`;
  if(elimSempre.length) g+=`\n- ELIMINATÓRIOS (sem estes, válidos e comprovados por imagem/PDF, NÃO aprove): ${elimSempre.join(', ')}.`;
  if(elimSolic.length)  g+=`\n- ELIMINATÓRIOS quando exigidos para esta função: ${elimSolic.join(', ')}.`;
  if(maritimo.length)   g+=`\n- DOCUMENTOS MARÍTIMOS obrigatórios (cobre por imagem; aprove quem tem STCW IGUAL OU SUPERIOR na MESMA cadeia): ${maritimo.join(', ')}.`;
  if(criticos.length)   g+=`\n- CRÍTICOS (Hunters NÃO fornece; avise com URGÊNCIA; não barram triagem): ${criticos.join(', ')}.`;
  if(leves.length)      g+=`\n- A HUNTERS FORNECE (tranquilize o candidato; não barram): ${leves.join(', ')}.`;
  if(padrao.length)     g+=`\n- OBRIGATÓRIOS comuns (liste como pendência; inclui PMSI online SBM; não barram): ${padrao.join(', ')}.`;
  if(cond.length)       g+=`\n- CONDICIONAIS (só exija se a tarefa requerer): ${cond.join(', ')}.`;
  g+=`\nNa aprovação, informe o status dos eliminatórios e relacione as pendências (separando CRÍTICOS que a Hunters não fornece). Eliminatórios e documentos marítimos só contam como válidos com imagem/PDF verificado pelo veredito técnico.]`;
  return g;
}

// ===== SYSTEM PROMPT DA MARINA =====
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
   - Marítimo — CIR: obrigatório para TODOS os marítimos (oficiais e não-oficiais).
   - Marítimo — STCW: obrigatório APENAS para OFICIAIS de náutica e de máquinas (CLC, CCB, 1ON, 2ON, OSM, 1OM, 2OM). NÃO peça STCW para as demais funções.
   - Offshore: CBSP e THUET (NÃO pergunte sobre HUET nem sobre certificado/atestado médico).
4. Certificados específicos da função, quando fizer sentido.
5. Inglês (apenas para oficiais).
6. Disponibilidade para embarque.
7. Coleta de documentos: peça currículo e fotos dos certificados.
8. Encerramento: informe que Rogério, Marcelo ou Anderson entrará em contato para agendar a entrevista.

APROVAÇÃO E ENVIO PARA A EQUIPE:
Um candidato só é APROVADO quando os TRÊS pontos forem confirmados:
(a) ele QUER a vaga, (b) está DISPONÍVEL, (c) certificados obrigatórios VÁLIDOS (conforme veredito técnico).
Quando os três estiverem confirmados, acrescente ao final da mensagem:
[[APROVADO|nome=NOME|telefone=TELEFONE|funcao=FUNÇÃO|certificados=LISTA COM VALIDADE|experiencia=RESUMO|disponibilidade=QUANDO]]
Use a marca UMA ÚNICA VEZ por candidato. Sem os três pontos confirmados, NÃO use a marca.

GLOSSÁRIO DE FUNÇÕES E SIGLAS (use SOMENTE estes significados; NUNCA invente):
NÁUTICA/CONVÉS: CLC=Capitão de Longo Curso; CCB=Capitão de Cabotagem; 1ON=Primeiro Oficial de Náutica; 2ON=Segundo Oficial de Náutica; MCB=Mestre de Cabotagem; CTR=Contramestre; MNC=Marinheiro de Convés; MOC=Moço de Convés; MAC=Auxiliar de Convés.
MÁQUINAS: OSM=Oficial Superior de Máquinas; 1OM=Primeiro Oficial de Máquinas; 2OM=Segundo Oficial de Máquinas; CDM=Condutor de Máquinas; ELT=Eletricista; MNM=Marinheiro de Máquinas; MOM=Moço de Máquinas; MAM=Auxiliar de Máquinas.
SAÚDE/SERVIÇOS: CZA=Cozinheiro; TAA=Taifeiro; ENF=Enfermeiro.
OFFSHORE: BCO=Ballast Control Operator; OGD=Guindasteiro; TST=Técnico de Segurança; HA=Homem de Área; IST=Instrumentista; Tec Mec=Técnico Mecânico; Rigger=Rigger; Sup Carg=Supervisor de Carga; Sup Merg=Supervisor de Mergulho; Mont And=Montador de Andaime; BBD=Bombeador; Sold=Soldador; Cald=Caldeireiro; ROP=Radioperador; Mooring Master=Mooring Master; OPC=Operador de Utilidades/Caldeira.
IMPORTANTE: "BCO" na SBM = Supervisor de Carga (JD10) com Certificação de Operador de Lastro. "Bombeador/Pumpman" = Operador de Carga (JD31).
TERMOS: FPSO=plataforma flutuante; PLSV=embarcação de dutos; ROV=robô submarino; DP=posicionamento dinâmico; DSV=embarcação de apoio a mergulho.
Se o candidato citar sigla fora desta lista, pergunte o que ele faz — nunca adivinhe.

RECONHECIMENTO E VALIDAÇÃO DE DOCUMENTOS:
Quando o candidato enviar foto ou PDF, o sistema verifica e te entrega um VEREDITO entre colchetes. Use EXATAMENTE a data e o status (VÁLIDO/VENCIDO) do veredito — nunca recalcule por conta própria.

TIPOS DE DOCUMENTOS QUE VOCÊ PODE RECEBER E COMO RECONHECÊ-LOS:

1. CBSP — DECLARAÇÃO PROVISÓRIA (mais comum):
   - Papel timbrado da empresa credenciada (Lighthouse-SMS, FAT Assessoria, RelyOn, West Group, FCO Offshore, Shelter, IPETEC, JJR Solutions, ATAC Fire, entre outras credenciadas DPC/NORMAM-104)
   - Título: "DECLARAÇÃO DE CONCLUSÃO DE CURSO" ou "DECLARAÇÃO"
   - Menciona "CURSO BÁSICO DE SEGURANÇA DE PLATAFORMA" e "NORMAM-104"
   - Nome do aluno em negrito, CPF, datas do curso, CNPJ da empresa
   - Assinatura do diretor + código QR de autenticidade (Pedagogo, KEMIS ou similar)
   - NÃO tem carimbo da Marinha — isso é normal neste formato
   - VALIDADE: data de EMISSÃO do documento + 90 dias (o veredito técnico já calcula)
   - Se a empresa emissora não for conhecida: aceitar provisoriamente, alertar no resumo e perguntar onde fez o curso

2. CBSP — CERTIFICADO HOMOLOGADO:
   - Papel timbrado da credenciada + carimbo/selo da Capitania dos Portos
   - Número de registro SISCNA + assinatura de Oficial da Marinha
   - VALIDADE: data de emissão + 5 anos (o veredito técnico calcula)
   - ATENÇÃO: o CBSP para profissionais não-aquaviários (PNT/TNA) NÃO usa o modelo DPC-1034

3. THUET — CERTIFICADO OPITO (único formato válido):
   EMISSORAS AUTORIZADAS NO BRASIL: RelyOn Nutec (Macaé/RJ), West Group, FCO Offshore.
   - Logo da empresa emissora no topo
   - Nome do aluno centralizado em negrito
   - Campos: "THUET – Treinamento em Escape de Helicópteros Submersos em Águas Tropicais"
   - Campo "Válido Até / Expiry Date" — usar esta data
   - Campo "Código de Registro OPITO" — número de 4 dígitos
   - Campo "OPITO UCN" — código numérico longo (ex: 97335195111225420958) — ELEMENTO CRÍTICO
   - Assinaturas do Gerente de Operações e Responsável Técnico (com CREA)
   - Código QR no canto inferior esquerdo
   ⛔ SE NÃO TIVER "OPITO UCN": é curso livre NÃO homologado — informar ao candidato que precisa refazer em empresa credenciada OPITO
   - Se a emissora não for RelyOn, West Group ou FCO: pedir foto mais clara, perguntar onde fez, aceitar provisoriamente mas alertar no resumo

4. CIR — CADERNETA DE INSCRIÇÃO E REGISTRO:
   - Documento físico tamanho passaporte, capa verde-azulada, emitido pela Marinha do Brasil
   - Pedir foto da PÁGINA 2 (dados pessoais com foto do titular)
   - Campos a extrair: Nº Inscrição, Nome, Categoria (ex: MARINHEIRO DE CONVÉS), Nível (número), Data de Emissão, Data de Validade
   - VALIDADE: usar a data de validade impressa no campo "Expiration Date"
   - Código QR verificável pelo app VIO da Marinha
   - A Categoria e o Nível determinam o STCW do aquaviário

5. DPC-1034 — CERTIFICADO STCW / HABILITAÇÃO / FORMAÇÃO DE AQUAVIÁRIOS:
   - Cabeçalho: "REPÚBLICA FEDERATIVA DO BRASIL / Autoridade Marítima Brasileira / Diretoria de Portos e Costas"
   - Código "DPC-1034" no canto inferior direito
   - Foto 3x4 do titular com carimbo; selo "ENSINO PROFISSIONAL MARÍTIMO"
   - Tipos: Formação de Aquaviários, Habilitação Profissional, Certificado de Proficiência (STCW VI/1)
   - Validade pode ser INDETERMINADA (formação básica) ou data específica
   - VALIDADE: usar data impressa; se "INDETERMINADA", registrar como vitalício

REGRAS GERAIS DE ANÁLISE DE DOCUMENTOS:
- A validade SÓ pode ser confirmada a partir da IMAGEM ou PDF. NUNCA aceite data que o candidato apenas DIGITOU ou FALOU — peça a foto para confirmar.
- Use EXATAMENTE a data e o status do veredito técnico entre colchetes. Não recalcule.
- Se VÁLIDO: confirme naturalmente (ex: "Seu CBSP está válido até [data do veredito], ótimo!").
- Se VENCIDO: avise com clareza e pergunte se consegue renovar.
- Se ILEGÍVEL: peça nova foto com boa iluminação, sem reflexo, documento inteiro e plano.
- Empresa emissora desconhecida (CBSP ou THUET): aceitar provisoriamente + alertar no resumo + pedir onde fez o curso.
- NUNCA escreva [[APROVADO|...]] citando certificado como válido sem ter visto o veredito técnico confirmando.
- Ao receber CURRÍCULO: leia a experiência, funções e tempo de embarque, e comente de forma natural.

SE A PESSOA NÃO TIVER INTERESSE OU DISPONIBILIDADE:
Não insista. Use: "Gostaria de abençoar alguém com essa vaga? Pode enviar meu contato [NUMERO_MARINA] ou me enviar o contato que eu mesmo ligo."
NUNCA invente número de telefone. Sempre use o marcador [NUMERO_MARINA] — o sistema substitui pelo número real.

VALORES DA HUNTERS: disponibilidade, educação, bom comportamento, inglês, experiência e caráter. Falta de cortesia é eliminatória.

MATRIZ DE TREINAMENTOS SBM (para vagas OFFSHORE da SBM Offshore):
Quando a vaga for SBM e você identificar a função, o sistema entrega uma observação [MATRIZ SBM...] classificando os certificados por nível. Siga à risca:
- ELIMINATÓRIOS (CBSP, THUET, CA-EBS — base de TODAS as funções SBM; GMDSS e Certificação BCO quando a função exigir): sem eles válidos e comprovados por imagem/PDF, o candidato NÃO pode ser aprovado. CA-EBS é eliminatório SEMPRE — NUNCA diga que é "só para ESS".
- DOCUMENTOS MARÍTIMOS: use o que a observação [MATRIZ SBM...] trouxer. STCW: aprove quem tem nível IGUAL OU SUPERIOR na MESMA cadeia (convés e máquinas são separadas).
- CRÍTICOS (Hunters não fornece — ex: NR-10, NR-37, NR-13, Andaime, AFF, TANK_ADV): não bloqueiam triagem, mas avise com URGÊNCIA.
- HUNTERS FORNECE (ex: NR-33, NR-35): tranquilize o candidato.
- OBRIGATÓRIOS comuns e PMSI: pendência a providenciar antes do embarque.
- CONDICIONAIS: só exija se a tarefa requerer.

Responda sempre em português, de forma cordial e profissional.`;

// ===== WEBHOOK PRINCIPAL =====
app.post('/webhook', async(req,res)=>{
  res.sendStatus(200);
  try{
    const body = req.body;
    if(body.event !== 'messages.upsert') return;
    const msg = body.data?.messages?.[0] || body.data;
    if(!msg || msg.key?.fromMe) return;
    const remoteJid = msg.key?.remoteJid || '';
    if(remoteJid.includes('@g.us')) return;
    const telefone = remoteJid.replace('@s.whatsapp.net','');
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
        midia = {tipo:'image', media_type: imagem.mimetype||'image/jpeg', dados: base64};
        if(!texto) texto = imagem.caption || 'Segue o documento em imagem.';
      } else {
        texto = 'Recebi sua imagem mas não consegui abrir. Pode reenviar, por favor?';
      }
    } else if(documento){
      const mime = documento.mimetype||'';
      console.log(`Documento recebido de ${telefone} (${mime}), baixando...`);
      const base64 = await baixarMidia(messageId);
      if(base64 && mime.includes('pdf')){
        midia = {tipo:'document', media_type:'application/pdf', dados: base64};
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

    let veredito = '';
    if(midia){
      veredito = await verificarCertificado(midia);
      if(veredito) console.log(`Veredito: ${veredito}`);
    }

    if(!conversas[telefone]) conversas[telefone]=[];
    let dicaMatriz = guiaMatriz(texto);
    if(!dicaMatriz){
      const ctx = conversas[telefone].map(x=>typeof x.content==='string'?x.content:'').join(' ');
      dicaMatriz = guiaMatriz(ctx);
    }
    const veredictoComMatriz = (veredito||'') + (dicaMatriz||'');
    let resposta = await processarIA(texto, conversas[telefone], midia, veredictoComMatriz);

    const marca = resposta.match(/\[\[APROVADO\|([\s\S]*?)\]\]/);
    if(marca){
      try{ await enviarAprovadoParaGrupo(marca[1], telefone); }
      catch(e){ console.error('Erro ao enviar aprovado ao grupo:', e); }
      resposta = resposta.replace(/\[\[APROVADO\|[\s\S]*?\]\]/g,'').trim();
    }

    resposta = aplicarNumeroMarina(resposta);

    conversas[telefone].push({role:'user', content: texto+(midia?' [enviou um documento]':'')});
    conversas[telefone].push({role:'assistant', content: resposta});
    if(conversas[telefone].length>20) conversas[telefone]=conversas[telefone].slice(-20);
    await enviarWA(telefone, resposta);
  }catch(e){console.error('Erro webhook:',e);}
});

// ===== ENDPOINTS DO APP =====
app.post('/claude', async(req,res)=>{
  try{
    const {messages,system,max_tokens} = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-sonnet-4-6',max_tokens:max_tokens||600,system:system||'',messages})
    });
    const data = await response.json();
    res.json(data);
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/login', (req,res)=>{
  try{
    const {senha} = req.body;
    if(!process.env.APP_SENHA) return res.status(500).json({ok:false,erro:'Senha do app não configurada no servidor.'});
    if(senha && senha===process.env.APP_SENHA) return res.json({ok:true});
    return res.status(401).json({ok:false});
  }catch(e){ res.status(500).json({ok:false,erro:e.message}); }
});

// ===== FUNÇÕES AUXILIARES =====
function blocoMidia(midia){
  return midia.tipo==='image'
    ? {type:'image', source:{type:'base64', media_type:midia.media_type, data:midia.dados}}
    : {type:'document', source:{type:'base64', media_type:'application/pdf', data:midia.dados}};
}

async function verificarCertificado(midia){
  try{
    const instrucao = `Analise este documento. Se NÃO for um certificado (ex: currículo, foto pessoal, outro), responda apenas: {"certificado":false}.
Se for um certificado, responda APENAS com JSON puro, sem texto ao redor, neste formato:
{"certificado":true,"nome":"NOME DO CERTIFICADO (ex: CBSP, THUET, CIR, STCW ou outro)","emissora":"NOME DA EMPRESA OU ÓRGÃO EMISSOR impresso no documento, ou null","data_validade":"DD/MM/AAAA da VALIDADE/VENCIMENTO impressa, ou null","data_conclusao":"DD/MM/AAAA da EMISSÃO/CONCLUSÃO/REALIZAÇÃO, ou null","tem_opito_ucn":true/false,"legivel":true}
IMPORTANTE:
- NÃO confunda data de emissão com data de validade.
- Para CIR: "Data de Emissão" vai em data_conclusao; "Data de Validade / Expiration Date" vai em data_validade.
- Para THUET: o campo "Válido Até / Expiry Date" vai em data_validade; o campo "Período/Period" vai em data_conclusao.
- Para Declaração CBSP provisória: a data da declaração (emissão) vai em data_conclusao; data_validade = null (o sistema calcula +90 dias).
- Para CBSP homologado: data de emissão em data_conclusao; data_validade = null (o sistema calcula +5 anos).
- tem_opito_ucn: true se houver campo "OPITO UCN" com código numérico, false caso contrário.
- emissora: nome da empresa/órgão emissor impresso no documento (ex: "Lighthouse-SMS", "RelyOn Nutec", "Marinha do Brasil").
- Use null sem aspas quando a informação não existir.
- Se ilegível, borrado ou incompleto: {"certificado":true,"legivel":false}.`;

    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model:'claude-sonnet-4-6',
        max_tokens:350,
        system:'Você extrai dados de documentos e responde somente em JSON puro, sem markdown, sem explicação.',
        messages:[{role:'user', content:[blocoMidia(midia),{type:'text',text:instrucao}]}]
      })
    });
    const d = await r.json();
    let txt = (d.content?.[0]?.text||'').replace(/```json|```/g,'').trim();
    let dados;
    try{ dados = JSON.parse(txt); }catch(e){ console.error('JSON inválido do extrator:',txt); return ''; }

    if(!dados.certificado) return '';
    if(dados.legivel===false){
      return `[OBSERVAÇÃO TÉCNICA: o documento parece ser um certificado, mas está ILEGÍVEL ou incompleto. Peça ao candidato para reenviar a foto com boa nitidez e o documento inteiro. NÃO considere nenhuma data até receber imagem legível.]`;
    }

    const nome = (dados.nome||'').toUpperCase();
    const emissora = dados.emissora || '';

    // Valida emissora para THUET e CBSP
    let alertaEmissora = '';
    if(nome.includes('THUET') || nome.includes('CBSP')){
      const tipoCert = nome.includes('THUET') ? 'THUET' : 'CBSP';
      const resultadoEmissora = validarEmissoraCertificado(tipoCert, emissora);
      if(resultadoEmissora.alerta){
        alertaEmissora = ` ${resultadoEmissora.alerta}`;
        // Para THUET: verifica também a presença do OPITO UCN
        if(tipoCert === 'THUET' && dados.tem_opito_ucn === false){
          alertaEmissora += ` ATENÇÃO CRÍTICA: este certificado NÃO possui o campo "OPITO UCN" — é um curso livre NÃO homologado pela OPITO. Informar ao candidato que o THUET precisa ser refeito em empresa credenciada OPITO (RelyOn Nutec, West Group ou FCO Offshore).`;
        }
      } else if(tipoCert === 'THUET' && dados.tem_opito_ucn === false){
        alertaEmissora = ` ATENÇÃO: este certificado THUET NÃO possui o campo "OPITO UCN" — é curso livre NÃO homologado. Informar ao candidato que precisa refazer em empresa credenciada OPITO.`;
      }
    }

    // Calcula validade
    let vencimento = null;
    let origemCalculo = '';
    const ehCincoAnos = VALIDADE_5_ANOS.some(c=>nome.includes(c));

    // Regra especial para Declaração CBSP provisória: +90 dias da emissão
    const ehDeclaracaoCbsp = nome.includes('CBSP') && !dados.data_validade;
    if(ehDeclaracaoCbsp){
      const base = parseData(dados.data_conclusao);
      if(base){
        vencimento = new Date(base);
        vencimento.setDate(vencimento.getDate()+90);
        origemCalculo = ` (declaração provisória; calculado: emissão ${dados.data_conclusao} + 90 dias)`;
      }
    } else {
      vencimento = parseData(dados.data_validade);
      if(!vencimento && ehCincoAnos){
        const base = parseData(dados.data_conclusao);
        if(base){
          vencimento = new Date(base);
          vencimento.setFullYear(vencimento.getFullYear()+5);
          origemCalculo = ` (sem validade impressa; calculado: emissão/conclusão ${dados.data_conclusao} + 5 anos)`;
        }
      } else if(!vencimento){
        vencimento = parseData(dados.data_conclusao);
      }
    }

    if(!vencimento){
      return `[OBSERVAÇÃO TÉCNICA: documento identificado como ${nome||'certificado'}${emissora?' emitido por '+emissora:''}, mas não foi possível determinar a validade. Peça ao candidato para confirmar a data de validade ou de conclusão.${alertaEmissora}]`;
    }

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const venc = new Date(vencimento); venc.setHours(0,0,0,0);
    const vencStr = venc.toLocaleDateString('pt-BR');
    const status = venc < hoje ? 'VENCIDO' : 'VÁLIDO';
    return `[OBSERVAÇÃO TÉCNICA (não mostre os colchetes ao candidato): certificado ${nome||''}${emissora?' ('+emissora+')':''} está ${status}. Vencimento: ${vencStr}${origemCalculo}.${alertaEmissora}]`;
  }catch(e){ console.error('Erro verificar certificado:',e); return ''; }
}

function parseData(s){
  if(!s||s==='null') return null;
  const m = String(s).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){
    let [_,d,mes,a]=m;
    if(a.length===2) a='20'+a;
    const dt = new Date(Number(a),Number(mes)-1,Number(d));
    return isNaN(dt)?null:dt;
  }
  const m2 = String(s).match(/(\d{1,2})[\/\-.](\d{4})/);
  if(m2){ const dt=new Date(Number(m2[2]),Number(m2[1])-1,1); return isNaN(dt)?null:dt; }
  return null;
}

function numeroMarinaFormatado(){
  const raw = (process.env.NUMERO_MARINA||'').replace(/\D/g,'');
  if(!raw) return '';
  let n = raw;
  if(n.startsWith('55')&&n.length>=12) n=n.slice(2);
  if(n.length===11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if(n.length===10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return process.env.NUMERO_MARINA;
}

function aplicarNumeroMarina(texto){
  if(!texto) return texto;
  const num = numeroMarinaFormatado();
  if(num) return texto.replace(/\[NUMERO_MARINA\]/g,num);
  return texto.replace(/\s*\(\s*\[NUMERO_MARINA\]\s*\)/g,'').replace(/\[NUMERO_MARINA\]/g,'').trim();
}

async function processarIA(texto, historico, midia, veredito){
  try{
    let conteudoUser;
    const textoFinal = veredito ? `${texto}\n${veredito}` : texto;
    if(midia){
      conteudoUser = [blocoMidia(midia),{type:'text',text:textoFinal}];
    } else {
      conteudoUser = textoFinal;
    }
    const msgs = [...historico,{role:'user',content:conteudoUser}];
    const hoje = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'long',year:'numeric'});
    const systemComData = `DATA DE HOJE: ${hoje}.\n\n`+SYSTEM_MARINA;
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-sonnet-4-6',max_tokens:500,system:systemComData,messages:msgs})
    });
    const d = await r.json();
    return d.content?.[0]?.text||'Olá! Tudo bem?';
  }catch(e){console.error('Erro IA:',e); return 'Olá! Tudo bem? Sou da Hunters Manpower.';}
}

async function baixarMidia(messageId){
  try{
    const rb = await fetch(`${process.env.EVO_URL}/chat/getBase64FromMediaMessage/${process.env.EVO_INSTANCE}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},
      body: JSON.stringify({message:{key:{id:messageId}},convertToMp4:false})
    });
    const db = await rb.json();
    const base64 = db?.base64||db?.media||db?.buffer;
    if(!base64) console.error('Sem base64 da mídia:',JSON.stringify(db).slice(0,300));
    return base64||null;
  }catch(e){console.error('Erro baixar mídia:',e); return null;}
}

async function transcreverAudio(messageId){
  try{
    if(!process.env.OPENAI_API_KEY)
      return 'Recebi seu áudio, mas no momento consigo ler apenas mensagens de texto. Pode me escrever, por favor?';
    const base64 = await baixarMidia(messageId);
    if(!base64) return 'Recebi seu áudio, mas não consegui abrir. Pode me escrever, por favor?';
    const audioBuffer = Buffer.from(base64,'base64');
    const form = new FormData();
    form.append('file',new Blob([audioBuffer],{type:'audio/ogg'}),'audio.ogg');
    form.append('model','whisper-1');
    form.append('language','pt');
    const rt = await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body: form
    });
    const dt = await rt.json();
    const transcrito = dt?.text||'';
    console.log(`Transcrição: ${transcrito}`);
    return transcrito||'Recebi seu áudio mas não entendi. Pode repetir por escrito?';
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
      body: JSON.stringify({number:telefone,text:mensagem})
    });
  }catch(e){console.error('Erro WA:',e);}
}

async function enviarAprovadoParaGrupo(dadosBrutos, telefoneCandidato){
  if(!process.env.GRUPO_ID){
    console.error('GRUPO_ID não configurado — resumo não enviado ao grupo.');
    return;
  }
  if(telefoneCandidato && aprovadosEnviados[telefoneCandidato]){
    console.log('Candidato já enviado ao grupo, ignorando duplicata:', telefoneCandidato);
    return;
  }
  if(telefoneCandidato) aprovadosEnviados[telefoneCandidato]=true;

  const campos = {};
  dadosBrutos.split('|').forEach(p=>{
    const i = p.indexOf('=');
    if(i>0){ campos[p.slice(0,i).trim().toLowerCase()]=p.slice(i+1).trim(); }
  });

  const telefone = telefoneCandidato||campos.telefone||'—';
  const resumo =
`🚢 *NOVO CANDIDATO APROVADO*

Nome: ${campos.nome||'—'}
Telefone: ${telefone}
Função: ${campos.funcao||'—'}
Certificados: ${campos.certificados||'—'}
Experiência: ${campos.experiencia||'—'}
Disponibilidade: ${campos.disponibilidade||'—'}`;
  try{
    await fetch(`${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':process.env.EVO_KEY},
      body: JSON.stringify({number:process.env.GRUPO_ID,text:resumo})
    });
    console.log(`Candidato aprovado enviado ao grupo: ${campos.nome||telefone}`);
  }catch(e){console.error('Erro ao enviar resumo ao grupo:',e);}
}

app.get('/', (req,res)=>{
  res.json({status:'Hunters Manpower Webhook ativo!',versao:'3.7'});
});

const PORT = process.env.PORT||3001;
app.listen(PORT,()=>console.log(`Webhook rodando na porta ${PORT}`));
