# Direct Turbine Controls — Site Mirror & Content Inventory

Source: https://directturbinecontrols.com/ — crawled 2026-07-12.
Raw HTML for every page below is saved in `mirror/raw/<slug>.html`.
Content summaries here are paraphrased for reference; refer to the raw HTML for exact wording when building final pages.

## Company facts (used across the site)

- **Legal name:** Direct Turbine Controls Corp.
- **Founded:** 2018, by Harikumar (control systems engineer) and James T (15+ yrs experience)
- **Address:** 88J Portland Ave, Bergenfield, NJ 07621, USA
- **Phone (main):** +1 201-244-6477
- **Phone (toll-free hotline):** 1-877-382-8721 (1-877-DTC-USA1)
- **Phone (direct):** 201-359-6828 (also WhatsApp)
- **Email:** info@dtc247.com (also sales@directturbinecontrols.com seen on homepage)
- **Positioning:** Independent (not GE-affiliated) repair/remanufacture/resale of turbine & excitation control boards — GE Mark I/II/IV/V/VI/VIe, EX2000/2100/2100e, plus Bently Nevada, ABB, Woodward, Westinghouse, Siemens, Ovation, Alstom, Rolls-Royce/Entronics, Allen Bradley, Fanuc, LCI panels, Foxboro
- **Core differentiators:** 20+ yrs engineering expertise, in-house lab with live control panels, same-day/emergency service, flat-rate repair (~35% of new-board cost), 1-year warranty on repairs (2-yr on Certified New/Refurbished parts), Advance Exchange program
- **Social:** Facebook, Twitter, YouTube (icon links, generic)
- **Legal pages:** Terms of Service, Privacy Policy

## Navigation structure (as built)

```
Home
About  (dropdown)
  About Us            /about-us/
  Why Choose Us?      /why-choose-us/
  Testimonials        /client-testimonials/
Parts Shop            /parts-shop/  (dropdown, links straight to landing page + 11 brand items)
  GE Boards & Turbine Control  /product-category/ge-boards-turbine-control/
  Bently Nevada                /product-category/bently-nevada/
  ABB                           /product-category/abb/
  Woodward                      /product-category/woodward/
  Westinghouse                  /product-category/westinghouse/
  Siemens                       /product-category/siemens/
  Ovation                       /product-category/ovation/
  Alstom                        /product-category/alstom/
  Rolls Royce                   /product-category/rolls-royce/
  Allen Bradley                 /product-category/allen-bradley/
  Fanuc                         /product-category/canuc/   (note: URL slug is "canuc", a legacy typo — label reads "Fanuc")
Services               /services/  (dropdown, links straight to landing page + 6 items)
  Testing & Certify             /test-and-certify/
  Circuit Board Repair & Refurbish /repair-refurbish/
  Spare Parts                   /spare-parts/
  Custom Service                /custom-service/
  Remanufacturing                /remanufacturing/
  Asset Recovery                 /asset-recovery/
FAQs                   /faqs/
Contact Us             /contact-us/  (dropdown)
  Emergency Service            /emergency-service/
Careers                /careers/
News                   /news/   (blog index, 25 articles — see below)

Footer legal: Terms of Service /terms-of-service/, Privacy Policy /privacy-policy/
```

Recommendation: preserve this IA as-is in the redesign (per constraint #2) — it's a clean, conventional B2B structure and matches how industrial buyers expect to navigate (brand-first parts lookup, service-type breakdown, dedicated emergency path). No restructuring proposed.

---

## Page-by-page content summary

### Home (`/`)
- Hero: "GE Turbine and Excitation Controls — MKII / MKIV / MKV / MKVI / MKVIe EX2000 / EX2100 & More"
- 5 service highlight cards, each linking to its service page: Testing & Repair, Spare Parts, Custom Service, Remanufacturing, Asset Recovery
- Company intro paragraph (engineers, 20+ yrs, GE control systems specialization)
- "Why Choose Us" 8-point differentiator list
- Downloadable brochure (PDF), contact block, newsletter signup, Chamber of Commerce badge

### About Us (`/about-us/`)
- H1 "About Us" — founding story (Harikumar + James T, est. 2018, quality-over-profit direct-to-customer model)
- "Our Story" — mission statement, 20+ yrs team expertise
- "Why Choose Us?" 6-point list: experience, advanced diagnostics, top-quality replacement parts, functional testing, fast service, warranty exceeding industry standard

### Why Choose Us (`/why-choose-us/`)
- Expanded version of the 6-point differentiator list from About Us, with more detail per point (e.g., diagnostics section breaks into 4 sub-capabilities: accurate issue ID, comprehensive system evaluation, real-time monitoring/data analysis, tailored repair solutions)

### Testimonials (`/client-testimonials/`)
- Heading: "You Are the Center of Our World"
- 4 client quotes with name/title/location (plant manager, purchase manager, supervisor, manager — NJ, CA, Philadelphia, NY)

### Parts Shop (`/parts-shop/`)
- Intro: inventory extends operational life of controls/monitoring/protection systems; all stock certified for functionality/reliability
- 11 brand cards + "Others" catalog, each showing item counts, e.g.:
  - GE Boards & Turbine Control — 1,244 parts
  - Bently Nevada — 4, Woodward — 4, Westinghouse — 3
  - ABB, Siemens, Ovation, Alstom, Rolls Royce, Allen Bradley, Fanuc — 1 each (thin catalogs)
  - Others — 95 parts
- Disclaimer: company independent, not affiliated with GE

### Brand category pages (`/product-category/*`) — 11 pages
Templated WooCommerce-style archive pages. Two patterns observed:
1. **GE Boards & Turbine Control**: not a flat list — organized into 7 model-family subcategories (Mark I/II, Mark IV, Mark V, Mark VI, Mark VIe, EX2000, EX2100/E) each with its own item count and "Browse Parts" link. Largest, most developed category.
2. **All other brands** (Bently Nevada, ABB, Woodward, Westinghouse, Siemens, Ovation, Alstom, Rolls Royce, Allen Bradley, Fanuc): thin catalogs, mostly showing a single placeholder-ish listing (part **DS200AAHA1**, "MARK V Board", in stock) repeated across categories — Woodward instead shows 2 empty subcategories ("Woodward Sub", "Woodward Sub1"). Bently Nevada is the most populated of this group (4 real parts: DS3800HMPG2D2D, 1900/25, DS200AAHA1, DS3800HMPG 2D2D) and has extra intro copy about their condition-monitoring transducers.
- Each product row shows: part number (link), description, stock status (In Stock/Ships Today or Ships 3-5 Days), Add to Cart button. Table has a "show 25/50/75/100" page-size control.
- **Note for later phases:** the non-GE brand catalogs are sparse/placeholder-like on the live site — worth flagging to the client whether that's real current inventory or a content gap before we build those pages out.

### Services (`/services/`)
- 5 service cards (same as homepage) — landing/hub page, no long intro copy

### Testing & Certify (`/test-and-certify/`)
- Verifies board functionality after storage/inventory issues; detailed report per unit
- Equipment: live panels, advanced diagnostics
- Compatible systems: GE MK II–MKVIe, EX2000/2100/2100e, LCI panels, Bently Nevada, Foxboro, Woodward, Rolls-Royce Entronics

### Circuit Board Repair & Refurbish (`/repair-refurbish/`)
- Flat-rate repair (~35% of new price)
- 5 common failure causes: component aging, burnt parts, dry solder joints, environmental stress, natural lifespan
- Same multi-brand compatibility as Testing & Certify

### Spare Parts (`/spare-parts/`)
- For OEM end-of-life systems
- 4 condition codes: Factory New (FN, OEM warranty), Certified New (CN, open-box/3rd-party, 2-yr DTC warranty), Refurbished (RF, 2-yr warranty), Used Surplus (UD, tested/repaired as needed)
- Brands: GE, Bently Nevada, ABB, Woodward, Westinghouse, Siemens, Ovation, Alstom, Rolls Royce, Allen Bradley, Fanuc

### Custom Service (`/custom-service/`)
- Positioned as flexible/bespoke: "any current service we do also can be customized according to your needs" — no fixed offering list, engineer-to-engineer consultative approach

### Remanufacturing (`/remanufacturing/`)
- Definition: diagnostics + component replacement + re-soldering + rigorous testing, beyond simple repair
- Benefits: environmental, economic, energy, supply-chain resilience, regulatory compliance
- 5-stage process: collect/inspect → diagnose → replace components → reassemble/solder → final QA
- Applications: automotive, industrial, telecom, medical (general remanufacturing industry context, not DTC-specific claims)

### Asset Recovery (`/asset-recovery/`)
- Buys surplus GE Speedtronic (Mark I–VIe), Rolls Entronic, Woodward, other industrial control modules
- Value props: maximize returns (cash toward future repairs), zero recycling cost (DTC handles logistics), fast/simple process, environmental angle
- Target customers: facilities with $10k+ unused inventory, plants at end-of-service-life, plants mid-upgrade with surplus to offload

### FAQs (`/faqs/`)
11 Q&As covering: where to ship boards for repair, turnaround (3-5 business days standard, same/next-day emergency, Advance Exchange), payment terms (credit card for new customers, Net 30 for approved accounts), return shipping (UPS/FedEx domestic, DHL international, insured), pricing (~35% flat rate), technical hotline (877-382-8721, M-F 9-5 EST), whether customers get their own board back (usually yes, substitutions possible for speed), fastest option (Advance Exchange = next-morning replacement), warranty (1 year, void if serial label removed), packaging (anti-static bag + bubble wrap + individual box), and reasons a board is deemed unrepairable (warping/cracking/burning/moisture/parts unavailable — no charge in that case, only return shipping if requested).

### Contact Us (`/contact-us/`)
- Full address, all phone numbers, email, WhatsApp
- Contact form with "Type of request" dropdown: General Contact / Emergency Services
- Emphasizes 24/7 responsiveness via hotline

### Emergency Service (`/emergency-service/`)
- Heading: "Emergency Service – 24-Hour, Worldwide Support"
- On-call 24/7, mobilizes immediately when parts in stock
- Same contact numbers as Contact Us page, emergency hotline emphasized

### Careers (`/careers/`)
- Short page: describes team (engineers, technicians, customer service reps)
- No specific job listings posted
- Apply via info@dtc247.com or phone; no stated culture/benefits detail — thin content, may want client input before final copy

### News (`/news/`)
- Blog index with 25 articles (title + link only captured at this pass; full article bodies not yet crawled — flagged below)
- Sample titles: "IS200EDEXG1B GE Exciter DE Excitation Control Board," "Revamping Faulty Circuits: Crucial Repairs for Electronics," "How Excitation Control Systems Drive Turbine Reliability," "Gas Turbine: How Much Power Does It Produce & How Does It Work," "What Is Speedtronic Mark V Control System," "The Four Main Types of Turbine Control System and Their Application," and 19 others — mostly educational/SEO content about turbine controls, GE systems, and specific board part numbers.

### Terms of Service (`/terms-of-service/`) & Privacy Policy (`/privacy-policy/`)
- Standard legal boilerplate pages, linked from footer only. Raw HTML saved; not summarized in detail (low relevance to visual redesign).

---

## Crawl scope note

This pass covers all **30 primary navigation pages** (every item reachable from the main nav + footer legal links) — raw HTML saved locally in `mirror/raw/`. The **25 individual News/blog articles** were identified (titles + URLs above) but their full bodies were not individually crawled yet, since they sit a level below the primary nav and the immediate goal is the homepage design. Say the word and I'll pull the full article bodies before we build the News section.
