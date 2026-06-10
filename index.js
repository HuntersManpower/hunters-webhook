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

// ===== MATRIZ DE TREINAMENTOS SBM OFFSHORE (planilha definitiva + regras Hunters) =====
// A matriz SBM define O QUE cada função exige (X/C). O NÍVEL define COMO a Marina comunica.
const ELIM_SEMPRE = ["CBSP","THUET","CAEBS"];   // eliminatório SEMPRE na SBM (base de TODAS as funções)
const ELIM_SOLICITADO = ["GMDSS","BCO"];        // eliminatório quando a matriz pede p/ a função

// Nível global de cada certificado (cruzado com a matriz por função)
const CERT_NIVEL = {
  "CBSP": "ELIM_SEMPRE",
  "AFF": "CRITICO",
  "TANK_BAS": "PADRAO",
  "TANK_ADV": "CRITICO",
  "CESS": "PADRAO",
  "GMDSS": "ELIM_SOLICITADO",
  "DG_AIR": "PADRAO",
  "SECURITY": "PADRAO",
  "NR33_ENT": "LEVE",
  "NR33_SUP": "LEVE",
  "RIGGING": "PADRAO",
  "CRANE_NR37": "PADRAO",
  "SCAFF": "CRITICO",
  "NR35": "LEVE",
  "HELIDECK": "PADRAO",
  "NR13_BOIL": "CRITICO",
  "NR13_PV": "CRITICO",
  "NR10": "CRITICO",
  "LEAK_NR34": "CRITICO",
  "NR37_BAS": "CRITICO",
  "NR37_ADV": "CRITICO",
  "DG_SEA": "PADRAO",
  "MAINT_SUP": "PADRAO",
  "BARGE_SUP": "PADRAO",
  "BCO": "ELIM_SOLICITADO",
  "ACLS": "PADRAO",
  "ATLS": "PADRAO",
  "THUET": "ELIM_SEMPRE",
  "CRANE_L3": "PADRAO",
  "CAEBS": "ELIM_SEMPRE",
  "PMSI": "PADRAO",
};

const CERT_NOMES = {
  "CBSP": "Curso Básico de Segurança de Plataforma (CBSP)",
  "AFF": "Combate a Incêndio Avançado",
  "TANK_BAS": "Curso Básico Operações de Carga em Navios-Tanque",
  "TANK_ADV": "Curso Avançado Operações de Carga em Petroleiros",
  "CESS": "CESS - Embarcações de Sobrevivência e Salvamento",
  "GMDSS": "Curso de Radioperador GMDSS",
  "DG_AIR": "Mercadorias Perigosas por via Aérea",
  "SECURITY": "Proficiência em Deveres de Segurança Designados",
  "NR33_ENT": "NR33 - Entrada em Espaço Confinado (16h)",
  "NR33_SUP": "NR33 - Supervisor de Espaço Confinado (40h)",
  "RIGGING": "Movimentação de Cargas (Rigging) NR-37/NR-34",
  "CRANE_NR37": "Curso Complementar Operador de Guindaste NR-37",
  "SCAFF": "Inspeção de Andaime NR34",
  "NR35": "NR-35 - Trabalho em Altura",
  "HELIDECK": "MCIA - Manobra e Combate a Incêndio de Aviação (Helideck)",
  "NR13_BOIL": "NR-13 - Operação de Caldeiras (Anexo I-A)",
  "NR13_PV": "NR-13 - Unidades de Processo / Vasos de Pressão (Anexo I-B)",
  "NR10": "NR-10 Básico (Segurança em Eletricidade)",
  "LEAK_NR34": "NR34 - Teste de Estanqueidade",
  "NR37_BAS": "NR-37 Básico",
  "NR37_ADV": "NR-37 Avançado",
  "DG_SEA": "Mercadorias Perigosas por Mar (IMDG)",
  "MAINT_SUP": "Certificação Supervisor de Manutenção",
  "BARGE_SUP": "Certificação Supervisor de Lastro",
  "BCO": "Certificação Operador de Controle de Lastro (BCO)",
  "ACLS": "ACLS - Suporte Avançado de Vida em Cardiologia",
  "ATLS": "ATLS - Suporte Avançado de Vida no Trauma",
  "THUET": "THUET (escape de helicóptero) - OPITO",
  "CRANE_L3": "Operações de Guindaste Offshore Nível 3",
  "CAEBS": "CA-EBS - Compressed Air Emergency Breathing System (OPITO)",
  "PMSI": "Vendor PMSI (treinamento interno SBM, online)",
};

// CIR + STCW por função, com a CADEIA (convés/máquinas) e o nível exato.
// Regra de hierarquia: aprovar quem tem nível IGUAL OU SUPERIOR ao exigido, na MESMA cadeia.
const MARITIMO_FUNCAO = {
  "Supervisor de Carga": ["CIR (1º Of. Náutica ou superior)", "STCW II/2 (cadeia Convés)"],
  "Operador de Carga": ["CIR de CDM", "STCW III/4 (cadeia Máquinas)"],
  "Mestre de Cabotagem (Contramestre)": ["CIR de MCB ou CTR", "STCW A-II/4 (cadeia Convés)"],
  "Marinheiro de Convés": ["CIR de MNC", "STCW A-II/5 (cadeia Convés)"],
  "2º Oficial de Máquinas / Operador de Manutenção": ["CIR (2º Of. Máquinas ou superior)", "STCW III/1 (cadeia Máquinas)"],
};

// Hierarquia STCW (fonte SINDMAR). Aprovar se nível do candidato >= exigido, na MESMA cadeia.
// Convés e Máquinas são cadeias SEPARADAS — III não substitui II.
const STCW_RANK = {
  CONVES:   { "A-II/5":1, "A-II/4":2, "II/1":3, "II/2":4 },
  MAQUINAS: { "III/7":1, "A-III/4":2, "III/4":2, "III/1":3, "III/2":4 }
};

const MATRIZ_TREINAMENTOS = {
  "Técnico de Laboratório": { jd:"JD21", obrig:["CBSP", "NR33_ENT", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:[] },
  "2º Oficial de Máquinas / Operador de Manutenção": { jd:"JD32", obrig:["CBSP", "NR33_ENT", "NR35", "NR13_BOIL", "NR13_PV", "LEAK_NR34", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:[] },
  "Técnico de Elétrica": { jd:"JD24", obrig:["CBSP", "NR33_ENT", "NR35", "NR10", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:[] },
  "Técnico de Instrumentação": { jd:"JD25", obrig:["CBSP", "NR33_ENT", "NR35", "NR10", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:[] },
  "Técnico de Mecânica": { jd:"JD26", obrig:["CBSP", "NR33_ENT", "NR35", "NR13_PV", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["HELIDECK"] },
  "Almoxarife": { jd:"JD28", obrig:["CBSP", "NR33_ENT", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["DG_AIR", "DG_SEA"] },
  "Assistente de Almoxarife": { jd:"JD38", obrig:["CBSP", "NR33_ENT", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["DG_AIR", "DG_SEA"] },
  "Supervisor de Carga": { jd:"JD10", obrig:["CBSP", "AFF", "TANK_ADV", "SECURITY", "NR33_SUP", "RIGGING", "NR35", "LEAK_NR34", "NR37_BAS", "NR37_ADV", "BCO", "THUET", "CAEBS", "PMSI"], cond:["CESS"] },
  "Operador de Carga": { jd:"JD31", obrig:["CBSP", "TANK_BAS", "NR33_ENT", "RIGGING", "NR35", "LEAK_NR34", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["CESS"] },
  "Mestre de Cabotagem (Contramestre)": { jd:"JD34", obrig:["CBSP", "SECURITY", "NR33_ENT", "RIGGING", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["CESS", "DG_AIR", "HELIDECK", "DG_SEA"] },
  "Marinheiro de Convés": { jd:"JD36", obrig:["CBSP", "NR33_ENT", "RIGGING", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["CESS", "DG_AIR", "HELIDECK", "DG_SEA"] },
  "Homem de Área": { jd:"JD-GP", obrig:["CBSP", "NR33_ENT", "RIGGING", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["CESS", "DG_AIR", "HELIDECK", "DG_SEA"] },
  "Operador de Guindaste": { jd:"JD35", obrig:["CBSP", "SECURITY", "NR33_ENT", "RIGGING", "CRANE_NR37", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CRANE_L3", "CAEBS", "PMSI"], cond:["DG_AIR", "HELIDECK", "DG_SEA"] },
  "Técnico de Segurança": { jd:"JD7", obrig:["CBSP", "AFF", "NR33_SUP", "RIGGING", "SCAFF", "NR35", "LEAK_NR34", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["DG_AIR", "HELIDECK", "DG_SEA"] },
  "Técnico de Segurança (Assistente)": { jd:"JD8", obrig:["CBSP", "NR33_ENT", "RIGGING", "SCAFF", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["DG_AIR", "HELIDECK", "DG_SEA"] },
  "Operador de Rádio": { jd:"JD29", obrig:["CBSP", "GMDSS", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:["NR35"] },
  "Operador de Produção": { jd:"JD30", obrig:["CBSP", "NR33_ENT", "NR35", "NR37_BAS", "NR37_ADV", "THUET", "CAEBS", "PMSI"], cond:[] },
};

// Mapeia o que o candidato disser (sigla/nome livre) para uma função da MATRIZ_TREINAMENTOS.
// Retorna a chave da matriz ou null se não reconhecer como função offshore SBM.
function mapearFuncaoSBM(textoFuncao){
  if(!textoFuncao) return null;
  const t = textoFuncao.toLowerCase();
  const regras = [
    [["guindast","crane","ogd"], "Operador de Guindaste"],
    [["mestre de cabotagem","contramestre","gp foreman","mcb"], "Mestre de Cabotagem (Contramestre)"],
    [["marinheiro de conv","gp operator ab","mnc","convés","conves"], "Marinheiro de Convés"],
    [["homem de área","homem de area"," ha","gp operator"], "Homem de Área"],
    [["supervisor de carga","cargo sup","sup carg","bco","ballast","controle de lastro"], "Supervisor de Carga"],
    [["operador de carga","cargo operator","bombeador","pumpman","bbd"], "Operador de Carga"],
    [["instrument","ist"], "Técnico de Instrumentação"],
    [["elétric","eletric","elt"], "Técnico de Elétrica"],
    [["mecân","mecan","tec mec"], "Técnico de Mecânica"],
    [["laborat","lab tech","tec lab"], "Técnico de Laboratório"],
    [["almoxarife assist","assistente de almox"], "Assistente de Almoxarife"],
    [["almoxarife","store keeper","storekeeper"], "Almoxarife"],
    [["assistente de segur","assistant safety"], "Técnico de Segurança (Assistente)"],
    [["segurança","seguranca","safety","tst"], "Técnico de Segurança"],
    [["rádio","radio","rop","gmdss"], "Operador de Rádio"],
    [["produção","producao","production operator","opc","utilidad"], "Operador de Produção"],
    [["manutenção","manutencao","maintenance operator","oficial de máquinas","oficial de maquinas","mom","2om"], "2º Oficial de Máquinas / Operador de Manutenção"],
  ];
  for(const [chaves, alvo] of regras){
    if(chaves.some(k=>t.includes(k))) return alvo;
  }
  return null;
}

// Monta um texto-guia da matriz para a função, classificando cada certificado por nível.
function guiaMatriz(textoFuncao){
  const chave = mapearFuncaoSBM(textoFuncao);
  if(!chave || !MATRIZ_TREINAMENTOS[chave]) return '';
  const f = MATRIZ_TREINAMENTOS[chave];
  const nome = c => CERT_NOMES[c] || c;
  // Classifica os obrigatórios da função pelos níveis globais
  const grupos = { ELIM_SEMPRE:[], ELIM_SOLICITADO:[], CRITICO:[], LEVE:[], PADRAO:[] };
  (f.obrig||[]).forEach(c=>{
    const nv = CERT_NIVEL[c] || 'PADRAO';
    (grupos[nv] = grupos[nv] || []).push(nome(c));
  });
  const cond = (f.cond||[]).map(nome);
  const elimSempre = grupos.ELIM_SEMPRE;
  const elimSolic  = grupos.ELIM_SOLICITADO;
  const criticos   = grupos.CRITICO;
  const leves      = grupos.LEVE;
  const padrao     = grupos.PADRAO;
  const maritimo   = MARITIMO_FUNCAO[chave] || [];

  let g = `\n\n[MATRIZ SBM — função reconhecida como "${chave}" (${f.jd}). Regras de certificado para esta vaga offshore SBM, por nível:`;
  if(elimSempre.length)
    g += `\n- ELIMINATÓRIOS (sem estes, válidos e comprovados por imagem/PDF, NÃO aprove): ${elimSempre.join(', ')}.`;
  if(elimSolic.length)
    g += `\n- ELIMINATÓRIOS quando exigidos para esta função (mesmo peso dos acima; sem eles não aprove): ${elimSolic.join(', ')}.`;
  if(maritimo.length)
    g += `\n- DOCUMENTOS MARÍTIMOS obrigatórios para esta função (cobre por imagem como os eliminatórios; aprove quem tem STCW de nível IGUAL OU SUPERIOR ao exigido, na MESMA cadeia — convés ou máquinas, que são separadas): ${maritimo.join(', ')}.`;
  if(criticos.length)
    g += `\n- CRÍTICOS (a Hunters NÃO fornece; avise o candidato com URGÊNCIA que precisa providenciar por conta, são cursos longos e indispensáveis para embarcar; NÃO barram a triagem mas registre como pendência crítica): ${criticos.join(', ')}.`;
  if(leves.length)
    g += `\n- A HUNTERS FORNECE (pode tranquilizar: a empresa oferece estes cursos; não barram): ${leves.join(', ')}.`;
  if(padrao.length)
    g += `\n- OBRIGATÓRIOS comuns (liste como pendência a providenciar antes do embarque; inclui o PMSI, treinamento interno online da SBM; não barram): ${padrao.join(', ')}.`;
  if(cond.length)
    g += `\n- CONDICIONAIS (só exija se o candidato for atuar em tarefa que requeira; caso contrário, ignore): ${cond.join(', ')}.`;
  g += `\nNa aprovação, no campo "certificados", informe o status dos eliminatórios e relacione as pendências (separando os CRÍTICOS que a Hunters não fornece). Eliminatórios e documentos marítimos só contam como válidos com imagem/PDF verificado pelo veredito técnico.]`;
  return g;
}


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
   - Marítimo — CIR: obrigatório para TODOS os marítimos (oficiais e não-oficiais).
   - Marítimo — STCW: obrigatório APENAS para OFICIAIS de náutica e de máquinas (CLC, CCB, 1ON, 2ON, OSM, 1OM, 2OM). NÃO peça STCW para as demais funções (MNC, MOC, MAC, CTR, MCB, CDM, ELT, MNM, MOM, MAM, CZA, TAA, ENF e outras). Para esses não-oficiais, cobre somente a CIR.
   - Offshore: CBSP e THUET (NÃO pergunte sobre HUET nem sobre certificado/atestado médico).
4. Certificados específicos da função, quando fizer sentido.
5. Inglês (apenas para oficiais).
6. Disponibilidade para embarque.
7. Coleta de documentos: peça currículo e fotos dos certificados.
8. Encerramento: informe que Rogério, Marcelo ou Anderson entrará em contato para agendar a entrevista.

APROVAÇÃO E ENVIO PARA A EQUIPE (muito importante):
Um candidato só é APROVADO quando os TRÊS pontos forem confirmados:
(a) ele QUER a vaga oferecida, (b) está DISPONÍVEL para o trabalho, (c) os certificados obrigatórios da vaga estão VÁLIDOS (conforme o veredito técnico do sistema).
Antes de aprovar, CONFIRME diretamente com o candidato, em mensagens naturais: pergunte se ele realmente quer a vaga e se está disponível para embarcar/trabalhar. Só prossiga após ele confirmar "sim".
Quando os três pontos estiverem confirmados, faça o encerramento normal E acrescente, na MESMA mensagem, ao final, uma marca técnica EXATAMENTE neste formato (o candidato não verá esta marca):
[[APROVADO|nome=NOME DO CANDIDATO|telefone=TELEFONE|funcao=FUNÇÃO|certificados=LISTA DE CERTIFICADOS COM VALIDADE|experiencia=RESUMO DA EXPERIÊNCIA|disponibilidade=QUANDO ESTÁ DISPONÍVEL]]
Preencha cada campo com o que você apurou na conversa. Use a marca [[APROVADO|...]] UMA ÚNICA VEZ por candidato, somente quando os três pontos estiverem confirmados. Se algum dos três não estiver ok, NÃO use a marca.

GLOSSÁRIO DE FUNÇÕES E SIGLAS (use SOMENTE estes significados; NUNCA invente o que uma sigla significa — se não souber, pergunte ao candidato):
NÁUTICA/CONVÉS: CLC = Capitão de Longo Curso; CCB = Capitão de Cabotagem; 1ON = Primeiro Oficial de Náutica; 2ON = Segundo Oficial de Náutica; MCB = Mestre de Cabotagem; CTR = Contramestre; MNC = Marinheiro de Convés; MOC = Moço de Convés; MAC = Auxiliar de Convés.
MÁQUINAS: OSM = Oficial Superior de Máquinas; 1OM = Primeiro Oficial de Máquinas; 2OM = Segundo Oficial de Máquinas; CDM = Condutor de Máquinas; ELT = Eletricista; MNM = Marinheiro de Máquinas; MOM = Moço de Máquinas; MAM = Auxiliar de Máquinas.
SAÚDE/SERVIÇOS: CZA = Cozinheiro; TAA = Taifeiro; ENF = Enfermeiro.
OFFSHORE: BCO = Ballast Control Operator (operador de controle de lastro); OGD = Guindasteiro; TST = Técnico de Segurança do Trabalho; HA = Homem de Área; IST = Instrumentista; Tec Mec = Técnico Mecânico; Rigger = Rigger; Sup Carg = Supervisor de Carga; Sup Merg = Supervisor de Mergulho; Mont And = Montador de Andaime; BBD = Bombeador; Sold = Soldador; Cald = Caldeireiro; ROP = Radioperador; Mooring Master = Mooring Master; OPC = Operador de Utilidades/Caldeira.
IMPORTANTE sobre BCO na SBM: quando a vaga offshore SBM for de "BCO", a função real é o Supervisor de Carga (JD10), que detém a Certificação de Operador de Lastro. Trate "BCO" como Supervisor de Carga. Já "Bombeador/Pumpman" corresponde ao Operador de Carga (JD31).
TERMOS: FPSO = plataforma flutuante de produção; PLSV = embarcação de lançamento de dutos; ROV = robô submarino; DP = posicionamento dinâmico; DSV = embarcação de apoio a mergulho; SMS = Saúde, Meio Ambiente e Segurança; EPI/EPC = equipamentos de proteção.
Se o candidato citar uma sigla que não está nesta lista, NÃO adivinhe — pergunte educadamente o que ele faz nessa função.

ANÁLISE DE DOCUMENTOS E VALIDADE DE CERTIFICADOS (regras críticas):
- A validade de um certificado SÓ pode ser confirmada a partir da IMAGEM ou PDF do documento. NUNCA aceite, registre ou cite data de certificado que o candidato apenas FALOU, ESCREVEU ou DIGITOU no texto/áudio. Se ele disser "meu CBSP é válido até tal data", agradeça e peça a FOTO ou PDF do certificado para confirmar — sem a imagem, o certificado NÃO é considerado verificado.
- Quando receber a foto/PDF, o sistema verifica a validade e te entrega o VEREDITO numa observação técnica entre colchetes. Você DEVE usar exatamente a data e o status (VÁLIDO/VENCIDO) que aparecem nessa observação. NÃO recalcule, NÃO reescreva e NÃO altere a data por conta própria — copie o que o veredito disser.
- Se o veredito disser VÁLIDO, confirme de forma natural usando a data do veredito (ex: "Seu CIR está válido até [data do veredito], ótimo!").
- Se disser VENCIDO, avise com clareza (ex: "Notei que seu THUET venceu em [data do veredito]. Para a vaga ele precisa estar válido. Você consegue renovar?").
- Se o veredito disser que o documento está ILEGÍVEL ou incompleto, peça educadamente para reenviar a foto com nitidez e o documento inteiro. Não considere nenhuma data até receber uma imagem legível.
- Se o veredito disser que não foi possível determinar a validade, peça ao candidato a foto da parte do certificado onde aparece a data de emissão/conclusão.
- Quando receber um CURRÍCULO, leia a experiência, funções e tempo de embarque, e comente de forma natural.
- NUNCA escreva a aprovação ([[APROVADO|...]]) de um candidato citando um certificado como válido se você não recebeu a imagem/PDF dele e não viu o veredito técnico confirmando. Sem imagem verificada, o certificado conta como NÃO comprovado.

SE A PESSOA NÃO TIVER INTERESSE OU DISPONIBILIDADE:
Não insista. Use a frase: "Gostaria de abençoar alguém com essa vaga? Pode enviar meu contato ou me enviar o contato que eu mesmo ligo."

VALORES DA HUNTERS: disponibilidade, educação, bom comportamento, inglês, experiência e caráter. Falta de cortesia é eliminatória.

MATRIZ DE TREINAMENTOS SBM (para vagas OFFSHORE da SBM Offshore):
Quando a vaga for offshore SBM e você identificar a função, o sistema te entrega uma observação [MATRIZ SBM...] classificando os certificados daquela função por NÍVEL. Siga à risca:
- ELIMINATÓRIOS (CBSP, THUET e CA-EBS — base obrigatória de TODAS as funções SBM; e, quando a função exigir, GMDSS e a Certificação BCO): sem eles, válidos e comprovados por imagem/PDF, o candidato NÃO pode ser aprovado. O CA-EBS é eliminatório SEMPRE na SBM — NUNCA diga que é "só para ESS" nem que é opcional.
- DOCUMENTOS MARÍTIMOS por função (CIR e STCW vêm na observação [MATRIZ SBM...] já com a cadeia e o nível certos). Use SEMPRE o que a observação trouxer; nunca invente. Exemplos do que é correto: Supervisor de Carga (= função "BCO" na SBM, que detém a Certificação de Operador de Lastro) precisa de CIR de 1º Oficial de Náutica ou superior + STCW II/2 (convés); Operador de Carga (= Bombeador/Pumpman) precisa de CIR de CDM + STCW III/4 (máquinas); Mestre de Cabotagem precisa de CIR de MCB ou CTR; Marinheiro de Convés, CIR de MNC. REGRA STCW: aprove quem tem nível IGUAL OU SUPERIOR ao exigido na MESMA cadeia (convés e máquinas são cadeias separadas; III não substitui II) — NUNCA elimine alguém por apresentar um STCW de nível superior ao exigido.
- CRÍTICOS (a Hunters NÃO fornece — ex: NR-10, NR-37 Básico/Avançado, NR-13 A/B, Inspeção de Andaime, Teste de Estanqueidade, Combate a Incêndio Avançado, Carga Avançado em Petroleiros): NÃO bloqueiam a triagem, mas avise o candidato com URGÊNCIA que ele precisa providenciar por conta, pois são cursos longos e indispensáveis para embarcar.
- A HUNTERS FORNECE (ex: NR-33, NR-35): pode tranquilizar o candidato dizendo que a empresa oferece esses cursos. Não bloqueiam.
- OBRIGATÓRIOS comuns e PMSI: liste como pendência a providenciar antes do embarque. O PMSI é treinamento interno online da SBM. Não bloqueiam.
- CONDICIONAIS: só pergunte/exija se o candidato for atuar em tarefa que requeira aquele curso.
Sempre que listar pendências (na conversa e na aprovação), deixe claro quais são CRÍTICAS (a Hunters não fornece, providenciar urgente) e quais a Hunters fornece.
Se a observação [MATRIZ SBM...] não aparecer (vaga puramente marítima, não-SBM), siga as regras marítimas já descritas (CIR para todos, STCW só para oficiais).

Responda sempre em português, de forma cordial e profissional.`;

app.post('/webhook', async(req,res)=>{
  res.sendStatus(200);
  try{
    const body = req.body;
    if(body.event !== 'messages.upsert') return;
    const msg = body.data?.messages?.[0] || body.data;
    if(!msg || msg.key?.fromMe) return;
    const remoteJid = msg.key?.remoteJid || '';
    // Ignora mensagens de GRUPO: a Marina não responde nada em grupos, só posta aprovados.
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
    // Tenta reconhecer a função (na mensagem atual ou no histórico) e anexa o guia da matriz SBM
    let dicaMatriz = guiaMatriz(texto);
    if(!dicaMatriz){
      const ctx = conversas[telefone].map(x=>typeof x.content==='string'?x.content:'').join(' ');
      dicaMatriz = guiaMatriz(ctx);
    }
    const veredictoComMatriz = (veredito||'') + (dicaMatriz||'');
    let resposta = await processarIA(texto, conversas[telefone], midia, veredictoComMatriz);

    // Detecta marca de aprovação [[APROVADO|...]] e envia resumo ao grupo da equipe
    const marca = resposta.match(/\[\[APROVADO\|([\s\S]*?)\]\]/);
    if(marca){
      try{ await enviarAprovadoParaGrupo(marca[1], telefone); }
      catch(e){ console.error('Erro ao enviar aprovado ao grupo:', e); }
      // Remove a marca para o candidato não ver
      resposta = resposta.replace(/\[\[APROVADO\|[\s\S]*?\]\]/g,'').trim();
    }

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
{"certificado":true,"nome":"NOME DO CERTIFICADO (ex: CBSP, THUET, CIR, STCW ou outro)","data_validade":"DD/MM/AAAA da VALIDADE/VENCIMENTO impressa, ou null","data_conclusao":"DD/MM/AAAA da EMISSÃO/CONCLUSÃO/REALIZAÇÃO, ou null","legivel":true}
IMPORTANTE: NÃO confunda data de emissão/conclusão com data de validade. A data de emissão/conclusão é quando o curso foi feito ou o documento foi emitido; a validade é quando ele expira. Documentos da Marinha do Brasil (CIR, CBGRN) trazem os dois campos rotulados: "Data de Emissão" e "Data de Validade" — leia cada um com atenção e coloque no campo correto. Se houver apenas UMA data e ela for claramente de emissão/realização, coloque em data_conclusao e deixe data_validade como null. Use null (sem aspas) quando a data não existir. Leia os dias, meses e anos exatamente como impressos; nunca invente nem estime datas. Se o documento estiver ilegível, borrado, cortado ou incompleto, responda {"certificado":true,"legivel":false}.`;

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

    if(dados.legivel === false){
      return `[OBSERVAÇÃO TÉCNICA: o documento parece ser um certificado, mas está ILEGÍVEL ou incompleto. Peça ao candidato, de forma educada, para reenviar a foto com boa nitidez e o documento inteiro. NÃO considere nenhuma data até receber uma imagem legível.]`;
    }

    const nome = (dados.nome||'').toUpperCase();
    // Determina a data de vencimento
    let vencimento = null;
    let origemCalculo = '';
    const ehCincoAnos = VALIDADE_5_ANOS.some(c=>nome.includes(c));

    // Regra geral: SEMPRE usar a data de validade impressa quando ela existir.
    vencimento = parseData(dados.data_validade);

    if(!vencimento){
      // Não há validade impressa.
      if(ehCincoAnos){
        // CIR / STCW / CBSP / THUET: se só houver a data de emissão/conclusão,
        // a validade é emissão/conclusão + 5 anos.
        const base = parseData(dados.data_conclusao);
        if(base){
          vencimento = new Date(base);
          vencimento.setFullYear(vencimento.getFullYear()+5);
          origemCalculo = ` (sem validade impressa; calculado: emissão/conclusão ${dados.data_conclusao} + 5 anos)`;
        }
      } else {
        // Demais certificados: na falta de validade, usa a data de conclusão como referência.
        vencimento = parseData(dados.data_conclusao);
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

// Monta o resumo do candidato aprovado e envia ao grupo da equipe de operações
async function enviarAprovadoParaGrupo(dadosBrutos, telefoneCandidato){
  if(!process.env.GRUPO_ID){
    console.error('GRUPO_ID não configurado — resumo não enviado ao grupo.');
    return;
  }
  // Trava de duplicata: se já enviamos este candidato, não envia de novo
  if(telefoneCandidato && aprovadosEnviados[telefoneCandidato]){
    console.log('Candidato já enviado ao grupo, ignorando duplicata:', telefoneCandidato);
    return;
  }
  if(telefoneCandidato) aprovadosEnviados[telefoneCandidato] = true;

  // dadosBrutos: "nome=...|telefone=...|funcao=...|certificados=...|experiencia=...|disponibilidade=..."
  const campos = {};
  dadosBrutos.split('|').forEach(p=>{
    const i = p.indexOf('=');
    if(i>0){ campos[p.slice(0,i).trim().toLowerCase()] = p.slice(i+1).trim(); }
  });

  // SEMPRE usa o telefone real da conversa (ignora o que a IA escreveu)
  const telefone = telefoneCandidato || campos.telefone || '—';
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
      body:JSON.stringify({number:process.env.GRUPO_ID,text:resumo})
    });
    console.log(`Candidato aprovado enviado ao grupo: ${campos.nome||telefone}`);
  }catch(e){console.error('Erro ao enviar resumo ao grupo:',e);}
}

app.get('/', (req,res)=>{
  res.json({status:'Hunters Manpower Webhook ativo!',versao:'3.4'});
});

const PORT = process.env.PORT||3001;
app.listen(PORT,()=>console.log(`Webhook rodando na porta ${PORT}`));
