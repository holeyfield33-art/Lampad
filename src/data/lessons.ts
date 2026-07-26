/**
 * Survival-English curriculum.
 *
 * Scoped deliberately: these are not general ESL lessons, they are the specific
 * exchanges a newcomer in Santa Clara County has to survive in their first
 * weeks — calling 911, a clinic visit, a landlord, a pay dispute, an
 * immigration appointment. Each lesson links back to the knowledge-base
 * passages covering the same situation, so the tutor can answer "what do I
 * actually say?" and "where do I actually go?" in the same breath.
 *
 * Translations are Spanish, Simplified Chinese and Vietnamese — the three most
 * widely spoken non-English languages in the county.
 */

export type Level = 'A1' | 'A2' | 'B1';

export interface Term {
  en: string;
  es: string;
  zh: string;
  vi: string;
  /** Usage note where a literal translation would mislead. */
  note?: string;
}

export interface Lesson {
  id: string;
  title: string;
  level: Level;
  /** When a learner would need this, in one line. */
  scenario: string;
  objective: string;
  vocabulary: Term[];
  phrases: Term[];
  dialogue: Array<{ speaker: string; line: string }>;
  grammar: { point: string; explanation: string; examples: string[] };
  practice: string[];
  /** Passage ids in the knowledge bundles covering the same situation. */
  relatedPassageIds: string[];
}

export const LESSONS: Lesson[] = [
  {
    id: 'lesson-emergency-call',
    title: 'Calling 911',
    level: 'A1',
    scenario: 'Someone is hurt, or you are in immediate danger.',
    objective: 'Give your location and say what is wrong in the first ten seconds.',
    vocabulary: [
      { en: 'emergency', es: 'emergencia', zh: '紧急情况', vi: 'trường hợp khẩn cấp' },
      { en: 'ambulance', es: 'ambulancia', zh: '救护车', vi: 'xe cứu thương' },
      { en: 'address', es: 'dirección', zh: '地址', vi: 'địa chỉ' },
      { en: 'hurt / injured', es: 'herido', zh: '受伤', vi: 'bị thương' },
      { en: 'bleeding', es: 'sangrando', zh: '流血', vi: 'chảy máu' },
      { en: 'breathing', es: 'respirando', zh: '呼吸', vi: 'thở' },
      {
        en: 'interpreter',
        es: 'intérprete',
        zh: '翻译员',
        vi: 'thông dịch viên',
        note: 'Say this word and your language. 911 can connect one.',
      },
    ],
    phrases: [
      {
        en: 'I need an ambulance.',
        es: 'Necesito una ambulancia.',
        zh: '我需要救护车。',
        vi: 'Tôi cần xe cứu thương.',
      },
      {
        en: 'My address is ...',
        es: 'Mi dirección es ...',
        zh: '我的地址是……',
        vi: 'Địa chỉ của tôi là ...',
      },
      {
        en: 'I need an interpreter. I speak Spanish.',
        es: 'Necesito un intérprete. Hablo español.',
        zh: '我需要翻译员。我说中文。',
        vi: 'Tôi cần thông dịch viên. Tôi nói tiếng Việt.',
      },
      {
        en: 'He is not breathing.',
        es: 'Él no está respirando.',
        zh: '他没有呼吸。',
        vi: 'Anh ấy không thở.',
      },
      {
        en: 'Please send help.',
        es: 'Por favor envíe ayuda.',
        zh: '请派人来帮忙。',
        vi: 'Xin hãy gửi người đến giúp.',
      },
    ],
    dialogue: [
      { speaker: 'Operator', line: '911, what is your emergency?' },
      { speaker: 'You', line: 'I need an ambulance. My friend is hurt.' },
      { speaker: 'Operator', line: 'What is your address?' },
      { speaker: 'You', line: 'One four four zero South Main Street, Milpitas.' },
      { speaker: 'Operator', line: 'Is he breathing?' },
      { speaker: 'You', line: 'Yes, but he is bleeding. Please send help.' },
    ],
    grammar: {
      point: 'Present continuous for what is happening right now',
      explanation:
        'Use "is" or "are" plus a verb ending in -ing to describe what is happening at this moment. In an emergency this is the tense you need, because the operator is asking about right now, not usually.',
      examples: [
        'He is bleeding. (right now)',
        'She is not breathing. (right now)',
        'They are waiting outside.',
      ],
    },
    practice: [
      'Say your own street address out loud, one number at a time.',
      'Describe an injury in one short sentence using "is" plus -ing.',
      'Ask for an interpreter in English, then say your language.',
    ],
    relatedPassageIds: ['county-emergency'],
  },
  {
    id: 'lesson-clinic-visit',
    title: 'At the clinic',
    level: 'A1',
    scenario: 'You are sick and going to a community clinic.',
    objective: 'Describe a symptom, say how long it has lasted, and ask what it will cost.',
    vocabulary: [
      { en: 'appointment', es: 'cita', zh: '预约', vi: 'cuộc hẹn' },
      { en: 'symptom', es: 'síntoma', zh: '症状', vi: 'triệu chứng' },
      { en: 'pain', es: 'dolor', zh: '疼痛', vi: 'đau' },
      { en: 'fever', es: 'fiebre', zh: '发烧', vi: 'sốt' },
      { en: 'cough', es: 'tos', zh: '咳嗽', vi: 'ho' },
      { en: 'prescription', es: 'receta médica', zh: '处方', vi: 'đơn thuốc' },
      { en: 'sliding scale', es: 'escala variable', zh: '浮动收费', vi: 'thang phí trượt', note: 'A fee based on your income. Ask for it by name.' },
    ],
    phrases: [
      {
        en: 'I would like to make an appointment.',
        es: 'Quisiera hacer una cita.',
        zh: '我想预约。',
        vi: 'Tôi muốn đặt một cuộc hẹn.',
      },
      {
        en: 'I have had this pain for three days.',
        es: 'He tenido este dolor por tres días.',
        zh: '我这个疼痛已经三天了。',
        vi: 'Tôi bị đau này ba ngày rồi.',
      },
      {
        en: 'How much will this cost?',
        es: '¿Cuánto va a costar esto?',
        zh: '这个要多少钱？',
        vi: 'Cái này giá bao nhiêu?',
      },
      {
        en: 'I do not have insurance.',
        es: 'No tengo seguro médico.',
        zh: '我没有医疗保险。',
        vi: 'Tôi không có bảo hiểm y tế.',
      },
      {
        en: 'Do you have a sliding scale fee?',
        es: '¿Tienen tarifa de escala variable?',
        zh: '你们有浮动收费吗？',
        vi: 'Ở đây có thang phí trượt không?',
      },
    ],
    dialogue: [
      { speaker: 'Receptionist', line: 'Good morning. How can I help you?' },
      { speaker: 'You', line: 'I would like to make an appointment. I have a fever.' },
      { speaker: 'Receptionist', line: 'How long have you had it?' },
      { speaker: 'You', line: 'I have had a fever for three days.' },
      { speaker: 'Receptionist', line: 'Do you have insurance?' },
      { speaker: 'You', line: 'No, I do not. Do you have a sliding scale fee?' },
    ],
    grammar: {
      point: 'Present perfect with "for" to say how long',
      explanation:
        'Use "have had" plus "for" and a length of time to say something started in the past and is still true. Clinics always ask how long, so this pattern is worth memorising as a whole.',
      examples: [
        'I have had a cough for one week.',
        'She has had a fever since Monday.',
        'They have lived here for two months.',
      ],
    },
    practice: [
      'Describe a symptom you have had, using "for" and a length of time.',
      'Ask about cost in two different ways.',
      'Practise saying you have no insurance without apologising for it.',
    ],
    relatedPassageIds: ['county-health', 'county-211'],
  },
  {
    id: 'lesson-housing',
    title: 'Renting a room',
    level: 'A2',
    scenario: 'You are asking about a room and want to understand what you are signing.',
    objective: 'Ask about rent, deposit and lease length, and say no to what you do not understand.',
    vocabulary: [
      { en: 'rent', es: 'renta / alquiler', zh: '房租', vi: 'tiền thuê nhà' },
      { en: 'deposit', es: 'depósito', zh: '押金', vi: 'tiền đặt cọc' },
      { en: 'lease', es: 'contrato de arrendamiento', zh: '租约', vi: 'hợp đồng thuê nhà' },
      { en: 'utilities', es: 'servicios públicos', zh: '水电费', vi: 'tiện ích (điện nước)' },
      { en: 'landlord', es: 'arrendador / casero', zh: '房东', vi: 'chủ nhà' },
      { en: 'eviction', es: 'desalojo', zh: '驱逐', vi: 'trục xuất khỏi nhà' },
      { en: 'receipt', es: 'recibo', zh: '收据', vi: 'biên lai', note: 'Always ask for one when you pay cash.' },
    ],
    phrases: [
      {
        en: 'How much is the rent per month?',
        es: '¿Cuánto es la renta por mes?',
        zh: '每个月房租多少钱？',
        vi: 'Tiền thuê mỗi tháng là bao nhiêu?',
      },
      {
        en: 'Are utilities included?',
        es: '¿Están incluidos los servicios?',
        zh: '包括水电费吗？',
        vi: 'Có bao gồm tiền điện nước không?',
      },
      {
        en: 'How long is the lease?',
        es: '¿De cuánto tiempo es el contrato?',
        zh: '租约多长时间？',
        vi: 'Hợp đồng thuê dài bao lâu?',
      },
      {
        en: 'Can I have a receipt, please?',
        es: '¿Me puede dar un recibo, por favor?',
        zh: '请给我一张收据，好吗？',
        vi: 'Cho tôi xin biên lai được không?',
      },
      {
        en: 'I need to read this before I sign it.',
        es: 'Necesito leer esto antes de firmarlo.',
        zh: '我需要先读一遍再签字。',
        vi: 'Tôi cần đọc trước khi ký.',
      },
    ],
    dialogue: [
      { speaker: 'Landlord', line: 'The room is available on the first.' },
      { speaker: 'You', line: 'How much is the rent per month?' },
      { speaker: 'Landlord', line: 'Twelve hundred, plus a deposit of one month.' },
      { speaker: 'You', line: 'Are utilities included?' },
      { speaker: 'Landlord', line: 'Water is. Electricity is not.' },
      { speaker: 'You', line: 'I understand. I need to read the lease before I sign it.' },
    ],
    grammar: {
      point: 'Polite requests with "Can I" and "Could you"',
      explanation:
        '"Can I have ...?" and "Could you ...?" make a request without sounding demanding. Adding "please" at the end is normal and expected in the US, not excessive.',
      examples: [
        'Can I have a receipt, please?',
        'Could you write that down for me?',
        'Could you repeat that more slowly, please?',
      ],
    },
    practice: [
      'Ask three questions about a room before agreeing to anything.',
      'Say, out loud, that you need to read something before signing.',
      'Ask someone to repeat a number more slowly.',
    ],
    relatedPassageIds: ['county-housing'],
  },
  {
    id: 'lesson-transit',
    title: 'Getting around',
    level: 'A1',
    scenario: 'You need to take the bus, light rail or BART.',
    objective: 'Buy fare, ask which line to take, and confirm you are going the right way.',
    vocabulary: [
      { en: 'fare', es: 'tarifa / pasaje', zh: '车费', vi: 'tiền vé' },
      { en: 'transfer', es: 'transbordo', zh: '换乘', vi: 'chuyển tuyến' },
      { en: 'schedule', es: 'horario', zh: '时刻表', vi: 'lịch trình' },
      { en: 'stop / station', es: 'parada / estación', zh: '车站', vi: 'trạm / nhà ga' },
      { en: 'one way', es: 'de ida', zh: '单程', vi: 'một chiều' },
      { en: 'discount', es: 'descuento', zh: '折扣', vi: 'giảm giá' },
    ],
    phrases: [
      {
        en: 'Does this bus go to Milpitas Transit Center?',
        es: '¿Este autobús va al Centro de Tránsito de Milpitas?',
        zh: '这辆公交车去密尔皮塔斯交通中心吗？',
        vi: 'Xe buýt này có đến Trung tâm Trung chuyển Milpitas không?',
      },
      {
        en: 'Which line goes to San Jose?',
        es: '¿Cuál línea va a San José?',
        zh: '哪条线去圣何塞？',
        vi: 'Tuyến nào đi San Jose?',
      },
      {
        en: 'How much is a one-way fare?',
        es: '¿Cuánto cuesta un pasaje de ida?',
        zh: '单程车费多少钱？',
        vi: 'Vé một chiều giá bao nhiêu?',
      },
      {
        en: 'Is there a discount for low income?',
        es: '¿Hay descuento por bajos ingresos?',
        zh: '低收入有折扣吗？',
        vi: 'Có giảm giá cho người thu nhập thấp không?',
      },
      {
        en: 'Please tell me when to get off.',
        es: 'Por favor dígame cuándo bajar.',
        zh: '请告诉我什么时候下车。',
        vi: 'Xin cho tôi biết khi nào xuống xe.',
      },
    ],
    dialogue: [
      { speaker: 'You', line: 'Excuse me, does this bus go to the Milpitas Transit Center?' },
      { speaker: 'Driver', line: 'Yes, about fifteen minutes.' },
      { speaker: 'You', line: 'How much is a one-way fare?' },
      { speaker: 'Driver', line: 'Two fifty, or tap your Clipper card.' },
      { speaker: 'You', line: 'Thank you. Please tell me when to get off.' },
    ],
    grammar: {
      point: 'Yes/no questions with "does"',
      explanation:
        'To ask a yes/no question about a thing or a third person, start with "Does" and keep the verb in its base form — "Does this bus go...", not "Does this bus goes...".',
      examples: [
        'Does this train stop at Fremont?',
        'Does the clinic open on Saturday?',
        'Does he speak Spanish?',
      ],
    },
    practice: [
      'Ask whether a bus goes to three different places.',
      'Ask the price of a one-way fare.',
      'Ask for a low-income discount by name.',
    ],
    relatedPassageIds: ['county-transit'],
  },
  {
    id: 'lesson-food-benefits',
    title: 'Food and benefits',
    level: 'A1',
    scenario: 'You are visiting a food pantry or applying for food assistance.',
    objective: 'Ask what you need to bring and register without over-sharing.',
    vocabulary: [
      { en: 'pantry', es: 'despensa', zh: '食物救济站', vi: 'kho thực phẩm từ thiện' },
      { en: 'groceries', es: 'comestibles', zh: '食品杂货', vi: 'thực phẩm' },
      { en: 'benefits', es: 'beneficios', zh: '福利', vi: 'trợ cấp' },
      { en: 'to apply', es: 'solicitar', zh: '申请', vi: 'nộp đơn' },
      { en: 'eligible', es: 'elegible', zh: '符合资格', vi: 'đủ điều kiện' },
      { en: 'proof of address', es: 'comprobante de domicilio', zh: '地址证明', vi: 'giấy chứng minh địa chỉ' },
    ],
    phrases: [
      {
        en: 'What do I need to bring?',
        es: '¿Qué necesito traer?',
        zh: '我需要带什么？',
        vi: 'Tôi cần mang theo những gì?',
      },
      {
        en: 'Am I eligible?',
        es: '¿Soy elegible?',
        zh: '我符合资格吗？',
        vi: 'Tôi có đủ điều kiện không?',
      },
      {
        en: 'I would like to apply for food assistance.',
        es: 'Quisiera solicitar ayuda alimentaria.',
        zh: '我想申请食物补助。',
        vi: 'Tôi muốn nộp đơn xin trợ cấp thực phẩm.',
      },
      {
        en: 'Is this information confidential?',
        es: '¿Esta información es confidencial?',
        zh: '这些信息保密吗？',
        vi: 'Thông tin này có được bảo mật không?',
      },
      {
        en: 'I have two children.',
        es: 'Tengo dos hijos.',
        zh: '我有两个孩子。',
        vi: 'Tôi có hai đứa con.',
      },
    ],
    dialogue: [
      { speaker: 'Volunteer', line: 'Have you been here before?' },
      { speaker: 'You', line: 'No, this is my first time. What do I need to bring?' },
      { speaker: 'Volunteer', line: 'Just your name and how many people are in your household.' },
      { speaker: 'You', line: 'I have two children. Is this information confidential?' },
      { speaker: 'Volunteer', line: 'Yes, it stays with us.' },
    ],
    grammar: {
      point: 'Question words: what, how many, where, when',
      explanation:
        'Questions that need real information start with a question word, then a helping verb. "How many" is always followed by a plural noun.',
      examples: [
        'What do I need to bring?',
        'How many people live with you?',
        'Where do I sign up?',
      ],
    },
    practice: [
      'Ask what documents you need, using "What do I need to ...".',
      'Say how many people are in your household.',
      'Ask whether your information stays private.',
    ],
    relatedPassageIds: ['county-food', 'county-211'],
  },
  {
    id: 'lesson-school-enrollment',
    title: 'Enrolling your child in school',
    level: 'A2',
    scenario: 'You are registering a child at a local public school.',
    objective: 'Enrol a child and push back if you are asked for documents you do not have.',
    vocabulary: [
      { en: 'to enroll', es: 'inscribir / matricular', zh: '注册入学', vi: 'ghi danh' },
      { en: 'grade', es: 'grado', zh: '年级', vi: 'lớp' },
      { en: 'immunization records', es: 'registro de vacunas', zh: '疫苗接种记录', vi: 'hồ sơ chích ngừa' },
      { en: 'transcript', es: 'expediente académico', zh: '成绩单', vi: 'học bạ' },
      { en: 'school district', es: 'distrito escolar', zh: '学区', vi: 'học khu' },
      { en: 'free lunch program', es: 'programa de almuerzo gratis', zh: '免费午餐计划', vi: 'chương trình bữa trưa miễn phí' },
    ],
    phrases: [
      {
        en: 'I would like to enroll my daughter in school.',
        es: 'Quisiera inscribir a mi hija en la escuela.',
        zh: '我想给我女儿办理入学。',
        vi: 'Tôi muốn ghi danh cho con gái tôi đi học.',
      },
      {
        en: 'She is nine years old.',
        es: 'Ella tiene nueve años.',
        zh: '她九岁。',
        vi: 'Cháu chín tuổi.',
      },
      {
        en: 'I do not have those documents yet.',
        es: 'Todavía no tengo esos documentos.',
        zh: '我还没有那些文件。',
        vi: 'Tôi chưa có những giấy tờ đó.',
      },
      {
        en: 'What can I use instead?',
        es: '¿Qué puedo usar en su lugar?',
        zh: '我可以用什么代替？',
        vi: 'Tôi có thể dùng gì thay thế?',
      },
      {
        en: 'Does the school offer free lunch?',
        es: '¿La escuela ofrece almuerzo gratis?',
        zh: '学校提供免费午餐吗？',
        vi: 'Trường có bữa trưa miễn phí không?',
      },
    ],
    dialogue: [
      { speaker: 'Office staff', line: 'Do you have her immunization records?' },
      { speaker: 'You', line: 'I do not have those documents yet. What can I use instead?' },
      { speaker: 'Office staff', line: 'We can start the enrollment and you bring them later.' },
      { speaker: 'You', line: 'Thank you. Does the school offer free lunch?' },
      { speaker: 'Office staff', line: 'Yes, here is the application.' },
    ],
    grammar: {
      point: 'Saying you do not have something, without apologising',
      explanation:
        '"I do not have ... yet" states a fact and leaves the door open. Following it immediately with a question — "What can I use instead?" — keeps the conversation moving toward a solution rather than a refusal.',
      examples: [
        'I do not have a lease yet. What can I use instead?',
        'I do not have that form. Where can I get it?',
        'I do not have an ID card. Is a passport acceptable?',
      ],
    },
    practice: [
      'Say a child\'s age using "is ... years old".',
      'State that you lack a document, then immediately ask for an alternative.',
      'Ask one question about lunch, transport, or language support.',
    ],
    relatedPassageIds: ['county-school-enrollment'],
  },
  {
    id: 'lesson-work-pay',
    title: 'Asking about pay and hours',
    level: 'A2',
    scenario: 'You started a job, or you were not paid correctly.',
    objective: 'Ask about wage, hours and pay day, and raise a pay problem clearly.',
    vocabulary: [
      { en: 'wage', es: 'salario / sueldo', zh: '工资', vi: 'tiền lương' },
      { en: 'hourly rate', es: 'tarifa por hora', zh: '时薪', vi: 'lương theo giờ' },
      { en: 'overtime', es: 'horas extras', zh: '加班', vi: 'làm thêm giờ' },
      { en: 'pay stub', es: 'talón de pago', zh: '工资单', vi: 'phiếu lương' },
      { en: 'schedule', es: 'horario', zh: '排班', vi: 'lịch làm việc' },
      { en: 'break', es: 'descanso', zh: '休息时间', vi: 'giờ nghỉ' },
    ],
    phrases: [
      {
        en: 'What is the hourly rate?',
        es: '¿Cuál es la tarifa por hora?',
        zh: '时薪是多少？',
        vi: 'Lương theo giờ là bao nhiêu?',
      },
      {
        en: 'When is pay day?',
        es: '¿Cuándo es el día de pago?',
        zh: '什么时候发工资？',
        vi: 'Khi nào là ngày trả lương?',
      },
      {
        en: 'Can I have a pay stub?',
        es: '¿Me puede dar un talón de pago?',
        zh: '可以给我工资单吗？',
        vi: 'Cho tôi xin phiếu lương được không?',
      },
      {
        en: 'I worked forty-five hours last week.',
        es: 'Trabajé cuarenta y cinco horas la semana pasada.',
        zh: '我上周工作了四十五个小时。',
        vi: 'Tuần trước tôi làm bốn mươi lăm tiếng.',
      },
      {
        en: 'I was not paid for all my hours.',
        es: 'No me pagaron todas mis horas.',
        zh: '我的工时没有全部拿到工资。',
        vi: 'Tôi chưa được trả đủ số giờ đã làm.',
      },
    ],
    dialogue: [
      { speaker: 'You', line: 'Excuse me, I have a question about my paycheck.' },
      { speaker: 'Supervisor', line: 'Sure, what is it?' },
      { speaker: 'You', line: 'I worked forty-five hours last week, but I was not paid for all my hours.' },
      { speaker: 'Supervisor', line: 'Let me check the schedule.' },
      { speaker: 'You', line: 'Can I have a pay stub, please?' },
    ],
    grammar: {
      point: 'Simple past for finished work',
      explanation:
        'Use the simple past — "worked", "was", "did" — for work that is already finished. Regular verbs add -ed. This is the tense for describing what happened last week or last month.',
      examples: [
        'I worked ten hours on Saturday.',
        'They paid me on Friday.',
        'She did not receive a pay stub.',
      ],
    },
    practice: [
      'Say how many hours you worked last week.',
      'Raise a pay problem in one sentence, without apologising.',
      'Ask for a pay stub politely.',
    ],
    relatedPassageIds: ['county-worker-rights'],
  },
  {
    id: 'lesson-immigration-appointment',
    title: 'At an immigration appointment',
    level: 'B1',
    scenario: 'You have a USCIS appointment, an interview, or a meeting with a legal representative.',
    objective: 'Ask for an interpreter, ask for clarification, and never sign what you cannot read.',
    vocabulary: [
      { en: 'appointment notice', es: 'aviso de cita', zh: '预约通知', vi: 'giấy báo cuộc hẹn' },
      { en: 'receipt number', es: 'número de recibo', zh: '收据号码', vi: 'số biên nhận' },
      { en: 'evidence', es: 'evidencia / pruebas', zh: '证据', vi: 'bằng chứng' },
      { en: 'attorney', es: 'abogado', zh: '律师', vi: 'luật sư' },
      {
        en: 'accredited representative',
        es: 'representante acreditado',
        zh: '认证代表',
        vi: 'đại diện được công nhận',
        note: 'A non-lawyer authorised by the DOJ to represent you. A notario is not.',
      },
      { en: 'to sign', es: 'firmar', zh: '签字', vi: 'ký tên' },
    ],
    phrases: [
      {
        en: 'I need an interpreter, please.',
        es: 'Necesito un intérprete, por favor.',
        zh: '我需要一位翻译员，谢谢。',
        vi: 'Tôi cần một thông dịch viên.',
      },
      {
        en: 'Could you repeat that more slowly, please?',
        es: '¿Podría repetirlo más despacio, por favor?',
        zh: '可以请您说慢一点再说一遍吗？',
        vi: 'Xin vui lòng nhắc lại chậm hơn được không?',
      },
      {
        en: 'I do not understand this document.',
        es: 'No entiendo este documento.',
        zh: '我看不懂这份文件。',
        vi: 'Tôi không hiểu tài liệu này.',
      },
      {
        en: 'I would like to speak with my attorney before I sign.',
        es: 'Quisiera hablar con mi abogado antes de firmar.',
        zh: '我想先和我的律师谈谈再签字。',
        vi: 'Tôi muốn nói chuyện với luật sư trước khi ký.',
      },
      {
        en: 'Can I have a copy of this?',
        es: '¿Me puede dar una copia de esto?',
        zh: '可以给我一份副本吗？',
        vi: 'Cho tôi xin một bản sao được không?',
      },
    ],
    dialogue: [
      { speaker: 'Officer', line: 'Please review this statement and sign at the bottom.' },
      { speaker: 'You', line: 'I do not understand this document. Could you repeat that more slowly, please?' },
      { speaker: 'Officer', line: 'It is a summary of what you told me today.' },
      { speaker: 'You', line: 'I need an interpreter, please. I would like to speak with my attorney before I sign.' },
      { speaker: 'Officer', line: 'That is your right. Here is a copy.' },
    ],
    grammar: {
      point: 'Modal verbs for rights and requests: can, could, would like',
      explanation:
        '"I would like to ..." is a firm but polite way to state what you want. "Could you ...?" softens a request without weakening it. Asking for an interpreter or for time to read is a request, not a favour — you are allowed to make it.',
      examples: [
        'I would like to speak with my attorney.',
        'Could you write down the receipt number?',
        'Can I have a copy of this, please?',
      ],
    },
    practice: [
      'Ask for an interpreter in one sentence, naming your language.',
      'Say that you do not understand a document, then ask for a copy.',
      'Practise saying you want to talk to your attorney before signing.',
    ],
    relatedPassageIds: ['accredited-representatives', 'case-status'],
  },
];

export const LESSON_BY_ID = new Map(LESSONS.map(l => [l.id, l]));

/** Languages the phrasebook covers, in the order shown in the UI. */
export const LESSON_LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
] as const;

export type LessonLanguage = (typeof LESSON_LANGUAGES)[number]['code'];
