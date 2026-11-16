// Legal documents shown under More -> Legal -> Documents in the admin panel.
// Each doc: id, title, updated (shown as "Last updated"), and sections.
// A section has a heading plus blocks: {p:"text"}, {list:["..",".."]} or
// {table:{head:[..], rows:[[..],[..]]}}. In list items, text before the
// first ": " is shown in bold (e.g. "Account and login information: ...").
// To add a document, add another object to LEGAL_DOCS.
// `slug` sets its web address: https://admin.easyrepair.co.uk/more/legal/<slug>
// A public, no-login copy of every document is generated at that address on
// each build (see legal-pages.js + vite.config.js), so it can be linked from
// Google Play. Changing a slug changes the URL -- update Play Console if so.

export const LEGAL_DOCS = [
  {
    id: "admin-panel-privacy-policy",
    slug: "Admin-Panel-Privacy-Policy",
    title: "Admin Panel Privacy Policy",
    updated: "16 Nov 2026",
    sections: [
      { heading: "Who we are and what this policy covers", blocks: [
        { p: "The Easy Repair Admin Panel app (\u201cthe App\u201d) is an internal tool for authorised EasyRepair staff and partners. It is operated by Easyplan LTD, trading as EasyRepair, a company registered in England and Wales (company number 17244329), registered office 1 Canterbury Close, Chichester, West Sussex (\u201cwe\u201d, \u201cus\u201d, \u201cour\u201d)." },
        { p: "We are the data controller for personal data processed through the App. This policy explains what the App collects, how we use it, who we share it with and your rights under UK data protection law (the UK GDPR and the Data Protection Act 2018)." },
        { p: "The App provides mobile access to our web-based admin system at https://admin.easyrepair.co.uk. It is not intended for members of the public, and you need an account issued by us to sign in." },
      ]},
      { heading: "Information the App collects and processes", blocks: [
        { list: [
          "Account and login information: your name, email address, password (stored only in secure, hashed form by our authentication provider) and the role you are given in the system.",
          "Records you view or manage: through the App you can access information held in our admin system about customers (name, phone number, email, address and postcode, appliance type, brand and age, booking details, service plans and payment status) and about engineers and service providers (name, contact details, coverage areas, skills and job history).",
          "Activity information: actions you take in the system, such as creating, editing, assigning or cancelling bookings, so we can keep accurate records.",
          "Files you choose to upload or share: if you attach a file or share content from the App, we process that file for the purpose you chose.",
          "Session data: the App stores login session information (such as cookies or local storage) on your device so you stay signed in. It is not used for advertising or cross-app tracking.",
        ]},
      ]},
      { heading: "What the App does not collect", blocks: [
        { p: "The App only requests internet access. It does not collect your location, contacts, photos, microphone or camera data, call logs or SMS messages. It does not use the Android advertising ID, show adverts, or sell or share your data for advertising." },
        { p: "We do not knowingly collect special category data (such as health or religious information) through the App." },
      ]},
      { heading: "How and why we use information", blocks: [
        { table: { head: ["Purpose", "Lawful basis (UK GDPR)"], rows: [
          ["Letting authorised users sign in and controlling what each role can see", "Legitimate interests (running a secure business system); contract, where you work for or with us"],
          ["Managing repair bookings, assigning jobs to engineers and service providers, and handling service plans and payments", "Contract with our customers and partners; legitimate interests"],
          ["Sending booking confirmations and job notifications by SMS and email", "Contract; legitimate interests"],
          ["Keeping records of activity, preventing misuse and keeping the system secure", "Legitimate interests; legal obligation, where records must be kept"],
          ["Meeting legal, tax and accounting duties", "Legal obligation"],
        ]}},
        { p: "Some bookings are matched to engineers automatically, based on postcode area and appliance type. Staff can review and change any assignment." },
      ]},
      { heading: "Who we share information with", blocks: [
        { p: "We share personal data only where needed for the purposes above:" },
        { list: [
          "Engineers and service providers: those who carry out repairs receive the customer and job details they need to do the work.",
          "Service providers acting on our behalf: Supabase (database hosting and user authentication), Twilio (SMS messages), Resend (email delivery) and our website hosting provider. They process data only on our instructions.",
          "Google: distributes the App through Google Play. Google's own privacy policy covers data Google collects through Play.",
          "Professional advisers, regulators, courts or law enforcement: where the law requires it or to protect our legal rights.",
        ]},
        { p: "We do not sell personal data." },
      ]},
      { heading: "Retention, security and international transfers", blocks: [
        { p: "Retention. We keep user account data while the account is active and for up to 12 months after it is closed. Booking, customer and payment records are kept for up to 6 years to meet tax and accounting duties, then deleted or anonymised." },
        { p: "Security. Data is encrypted in transit (HTTPS). Access requires a login, and each user sees only what their role allows. No system is completely secure, so please keep your login details private and tell us straight away if you think your account has been misused." },
        { p: "International transfers. Some of our service providers may process data outside the UK. Where they do, we rely on safeguards approved under UK law, such as UK adequacy regulations or the International Data Transfer Agreement / UK Addendum to the EU Standard Contractual Clauses." },
      ]},
      { heading: "Your rights", blocks: [
        { p: "You have the right to access your personal data, have it corrected or erased, restrict or object to how we use it, and receive a copy in a portable format. Some rights apply only in certain circumstances. To make a request, email admin@easyrepair.co.uk. We will reply within one month." },
        { p: "You can also complain to the Information Commissioner's Office (ICO) at ico.org.uk or on 0303 123 1113. We would appreciate the chance to resolve your concern first." },
      ]},
      { heading: "Deleting your account", blocks: [
        { p: "To close your App account and delete its data, email admin@easyrepair.co.uk from your registered address. We will delete your account data except records we must keep by law, as described under Retention." },
      ]},
      { heading: "Children", blocks: [
        { p: "The App is for business use only and is not intended for anyone under 18." },
      ]},
      { heading: "Changes to this policy", blocks: [
        { p: "We may update this policy from time to time. The \u201cLast updated\u201d date at the top shows when it last changed, and we will tell users about significant changes through the App or by email." },
      ]},
      { heading: "Contact us", blocks: [
        { p: "Easyplan LTD, trading as EasyRepair\n1 Canterbury Close, Chichester, West Sussex\nEmail: admin@easyrepair.co.uk\nWebsite: https://easyrepair.co.uk" },
      ]},
    ],
  },
];

// Web path for a document, e.g. "/more/legal/Admin-Panel-Privacy-Policy".
export const legalDocPath = (doc) => `/more/legal/${doc.slug}`;
