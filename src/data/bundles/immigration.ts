import type { KnowledgeBundle } from '../schema';

/**
 * Visa and work-authorization passages.
 *
 * Every regulatory claim here is a plain-language restatement of text stored
 * verbatim in `../sources/cfr-excerpts.json`, pulled from the eCFR API on the
 * date in `verified`. `test/data.test.mjs` checks that each cited excerpt
 * exists and that the numbers asserted below ("three of eight", "3 years",
 * "24 months") actually appear in the regulation text.
 *
 * This is general information to help someone orient and ask better questions.
 * It is not legal advice and it is not a substitute for a licensed immigration
 * attorney or a DOJ-accredited representative.
 */
export const IMMIGRATION_BUNDLE: KnowledgeBundle = {
  id: 'immigration',
  title: 'US Visa & Work Authorization',
  description:
    'Plain-language summaries of federal immigration regulations, each traceable to the Code of Federal Regulations.',
  authority: 'Title 8, Code of Federal Regulations (eCFR)',
  passages: [
    {
      id: 'o1a-standard',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'The O-1A visa is for people with extraordinary ability in science, education, business, or athletics. The regulation defines extraordinary ability in these fields as a level of expertise showing you are one of the small percentage who have risen to the very top of your field. You must also show sustained national or international acclaim. The O-1B category covers the arts, where the standard is distinction: a high level of achievement, so that you are renowned, leading, or well-known in your field.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 214.2(o)(3)(ii)',
      url: 'https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(o)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: [
        '8 CFR 214.2(o)(3)(ii) extraordinary ability definition',
        '8 CFR 214.2(o)(3)(ii) arts definition',
      ],
    },
    {
      id: 'o1a-criteria',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'To qualify for O-1A you must show either a major internationally recognized award such as the Nobel Prize, or at least three of these eight forms of evidence: nationally or internationally recognized prizes or awards for excellence; membership in associations that require outstanding achievement, judged by recognized experts; published material about you in professional or major trade publications or major media; participation as a judge of the work of others in your field or an allied field; original scientific, scholarly, or business-related contributions of major significance; authorship of scholarly articles in professional journals or major media; employment in a critical or essential capacity at organizations with a distinguished reputation; and a high salary or other high remuneration, evidenced by contracts or other reliable evidence. If these criteria do not readily apply to your occupation, comparable evidence may be submitted instead.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 214.2(o)(3)(iii)',
      url: 'https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(o)(3)(iii)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: ['8 CFR 214.2(o)(3)(iii) O-1A evidentiary criteria'],
    },
    {
      id: 'o1-consultation',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'An O-1 petition for extraordinary ability requires a written consultation. The petitioner must obtain an advisory opinion from a peer group in your area of ability, which may include a labor organization, or from a person or persons with expertise in your area. A favorable opinion should describe your ability and achievements, describe the duties you will perform, and state whether the position requires someone of extraordinary ability. A consulting organization with no objection may instead submit a letter of no objection. If the opinion is not favorable, it must set out the specific facts supporting its conclusion.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 214.2(o)(5)',
      url: 'https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(o)(5)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: ['8 CFR 214.2(o)(5) consultation'],
    },
    {
      id: 'o1-duration',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'An approved O-1 petition is valid for the period the director decides is needed to accomplish the event or activity, and cannot exceed 3 years. After that, an extension of stay may be authorized in increments of up to 1 year to continue or complete the same event or activity, plus an additional 10 days to get your personal affairs in order. There is no fixed cap on the number of extensions, but each one must be tied to the same event or activity. A denial of an extension request cannot be appealed.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 214.2(o)(6)(iii)(A), 8 CFR 214.2(o)(12)(ii)',
      url: 'https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(o)(6)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: [
        '8 CFR 214.2(o)(6)(iii)(A) validity',
        '8 CFR 214.2(o)(12)(ii) extension period',
      ],
    },
    {
      id: 'eb1a-criteria',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'EB-1A is the employment-based first-preference green card category for people of extraordinary ability, defined as being one of that small percentage who have risen to the very top of the field. A petition must show sustained national or international acclaim, through either a one-time major internationally recognized award or at least three of ten forms of evidence. The ten overlap with the O-1A list but add three more: display of your work at artistic exhibitions or showcases; performance in a leading or critical role for organizations with a distinguished reputation; and commercial success in the performing arts, shown by box office receipts or sales. If these standards do not readily apply to your occupation, comparable evidence may be submitted.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 204.5(h)(2), 8 CFR 204.5(h)(3)',
      url: 'https://www.ecfr.gov/current/title-8/section-204.5#p-204.5(h)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: [
        '8 CFR 204.5(h)(2) extraordinary ability definition',
        '8 CFR 204.5(h)(3) EB-1A initial evidence',
      ],
    },
    {
      id: 'eb1a-self-petition',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'EB-1A does not require a job offer. Neither an offer of employment in the United States nor a labor certification is required for the extraordinary-ability category, which means you can petition for yourself rather than depending on an employer to sponsor you. The petition must still include clear evidence that you are coming to the United States to continue working in your area of expertise. That evidence can be letters from prospective employers, contracts or other prearranged commitments, or a statement from you detailing how you intend to continue your work. This is a key practical difference from O-1, which is a temporary category filed by a petitioner on your behalf.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 204.5(h)(5)',
      url: 'https://www.ecfr.gov/current/title-8/section-204.5#p-204.5(h)(5)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: ['8 CFR 204.5(h)(5) no offer of employment required'],
    },
    {
      id: 'f1-opt',
      bundle: 'immigration',
      topic: 'work-authorization',
      text: 'Optional Practical Training, or OPT, lets an F-1 student work in a job directly related to their major area of study. A student may be authorized 12 months of practical training, and becomes eligible for another 12 months when they move to a higher educational level, for example from a bachelor\'s to a master\'s degree. To be eligible you must have been enrolled full time for one full academic year at an SEVP-certified college, university, conservatory, or seminary. Students in English language training programs are not eligible for practical training.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 214.2(f)(10)',
      url: 'https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(f)(10)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: ['8 CFR 214.2(f)(10) practical training'],
    },
    {
      id: 'f1-stem-opt',
      bundle: 'immigration',
      topic: 'work-authorization',
      text: 'A student with a qualifying degree in science, technology, engineering, or mathematics can apply to extend post-completion OPT by 24 months. You apply while you are still in a valid period of post-completion OPT. The extension is for 24 months for the first qualifying degree for which you have completed all course requirements, excluding a thesis or equivalent, including a qualifying degree that is part of a dual degree program. Combined with the initial 12 months of OPT, a STEM graduate can have up to 36 months of work authorization on F-1 status.',
      source: 'Code of Federal Regulations',
      citation: '8 CFR 214.2(f)(10)(ii)(C)',
      url: 'https://www.ecfr.gov/current/title-8/section-214.2#p-214.2(f)(10)(ii)(C)',
      verified: '2026-07-26',
      verifiedBy: 'primary-source',
      provenanceKeys: ['8 CFR 214.2(f)(10)(ii)(C) STEM extension'],
    },
    {
      id: 'accredited-representatives',
      bundle: 'immigration',
      topic: 'legal',
      text: 'Only two kinds of people may legally give you immigration legal advice and represent you: licensed attorneys, and representatives accredited by the Department of Justice through the Recognition and Accreditation Program. A notary public, or notario, is not an immigration lawyer in the United States, even though notario means lawyer in some countries. Someone who charges you to fill out immigration forms without being an attorney or an accredited representative is not authorized to advise you, and bad filings can damage your case. The Department of Justice publishes the official list of recognized organizations and accredited representatives, and a list of free legal service providers by state.',
      source: 'US Department of Justice, Executive Office for Immigration Review',
      url: 'https://www.justice.gov/eoir/recognition-and-accreditation-program',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'case-status',
      bundle: 'immigration',
      topic: 'visa-status',
      text: 'When USCIS accepts a petition or application it issues a receipt notice, Form I-797, which carries a 13-character receipt number. You can use that receipt number to check the status of your case online at the USCIS case status service, and to create a USCIS online account that shows notices and lets you respond to requests for evidence. Keep a copy of every notice you receive. Nobody should ever charge you to check your own case status, and USCIS does not ask for payment by gift card, wire transfer, or cryptocurrency.',
      source: 'US Citizenship and Immigration Services',
      url: 'https://egov.uscis.gov/casestatus/landing.do',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
  ],
};
