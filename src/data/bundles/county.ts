import type { KnowledgeBundle } from '../schema';

/**
 * Santa Clara County / Milpitas local resources.
 *
 * The original five passages are preserved verbatim in `text` — every phone
 * number in here was already shipping and is unchanged. What is new is the
 * provenance: each passage now names the organisation it describes and links
 * somewhere a user can confirm the number before dialling it.
 *
 * These are marked `needs-review` because local hours, addresses and numbers
 * drift, and none of them could be re-confirmed against a live source from the
 * build environment. `docs/DATA_REVIEW.md` tracks the sign-off.
 */
export const COUNTY_BUNDLE: KnowledgeBundle = {
  id: 'county',
  title: 'Santa Clara County Survival Guide',
  description:
    'Emergency, transit, housing, health and food resources for Milpitas and Santa Clara County.',
  authority: 'County and city service providers',
  passages: [
    {
      id: 'county-emergency',
      bundle: 'county',
      topic: 'emergency',
      text: 'Milpitas Police Department Non-emergency dispatch can be reached at (408) 586-2400, located at 1275 N Milpitas Blvd. For any immediate threat, emergency, or safety hazard, call 911 directly. Santa Clara County Suicide & Crisis Lifeline is available 24/7 by calling or texting 988. Free legal services are available to newcomers via the confidential County Support network.',
      source: 'Milpitas Police Department; 988 Suicide & Crisis Lifeline',
      url: 'https://www.milpitas.gov/159/Police',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-transit',
      bundle: 'county',
      topic: 'transit',
      text: 'The VTA (Santa Clara Valley Transportation Authority) operates buses and light rails across Milpitas. The Orange Line links the Milpitas Transit Center directly with Mountain View and San Jose. The BART station in Milpitas provides rapid rail connections to Fremont, Oakland, and San Francisco. Low-income transit discounts are available via Clipper START.',
      source: 'Santa Clara Valley Transportation Authority (VTA)',
      url: 'https://www.vta.org/',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-housing',
      bundle: 'county',
      topic: 'housing',
      text: 'The Here4You Hotline is the central hub for seeking emergency shelter and transitional housing in Santa Clara County. Reach them daily at (408) 385-2400. Tenants in Milpitas are protected against arbitrary evictions under county law. If you face tenant distress or illegal lockouts, call the Bay Area Legal Aid team at (800) 551-5554.',
      source: 'Santa Clara County Office of Supportive Housing; Bay Area Legal Aid',
      url: 'https://osh.sccgov.org/homelessness/how-get-help',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-health',
      bundle: 'county',
      topic: 'health',
      text: 'Santa Clara Valley Medical Center (VMC) provides quality medical care, vaccinations, and dental checkups to all residents regardless of legal or immigration status. The Milpitas Clinic is located at 143 N Main St, Milpitas, CA. All patient consultations are protected and private. Call (408) 957-0900 to schedule appointments.',
      source: 'Santa Clara Valley Healthcare',
      url: 'https://scvh.sccgov.org/',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-food',
      bundle: 'county',
      topic: 'food',
      text: 'Milpitas Food Pantry provides groceries, fresh vegetables, and baby formula to families in need. They are located at 1440 S Main St, Milpitas. Newcomers can register without showing official state identification. CalFresh nutrition benefits can be applied for by dialing 211 for county enrollment support.',
      source: 'Milpitas Food Pantry; 211 Bay Area',
      url: 'https://www.milpitasfoodpantry.org/',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-211',
      bundle: 'county',
      topic: 'legal',
      text: 'Dialing 211 connects you to a free, confidential county referral line, available 24 hours a day in many languages. 211 can route you to food assistance, shelter, healthcare enrollment, utility bill help, childcare, and legal aid. It is a good first call when you do not know which agency handles your problem. The service does not ask about immigration status to give you a referral.',
      source: '211 Bay Area',
      url: 'https://211bayarea.org/',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-school-enrollment',
      bundle: 'county',
      topic: 'education',
      text: 'Every child in California has the right to a free public education regardless of the immigration status of the child or their parents. Public schools enroll children who live in the district and cannot require a social security number or immigration documents as a condition of enrollment. In Milpitas, contact Milpitas Unified School District to enroll. Bring proof of address, proof of the child\'s age, and immunization records if you have them; the district can advise you if documents are missing.',
      source: 'Milpitas Unified School District',
      url: 'https://www.musd.org/',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
    {
      id: 'county-worker-rights',
      bundle: 'county',
      topic: 'rights',
      text: 'California labor protections — minimum wage, overtime, meal and rest breaks, and the right to be paid for all hours worked — apply to workers regardless of immigration status. If an employer does not pay you, you can file a wage claim with the California Labor Commissioner, and it is illegal for an employer to retaliate against you for filing. The Labor Commissioner does not ask about immigration status when processing a wage claim.',
      source: 'California Department of Industrial Relations, Labor Commissioner\'s Office',
      url: 'https://www.dir.ca.gov/dlse/',
      verified: '2026-07-26',
      verifiedBy: 'needs-review',
    },
  ],
};
