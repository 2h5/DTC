/* Site-wide search index: every brand, series and individual part that
   exists on the site today. Hand-maintained alongside the catalog (no
   backend/build step yet) - when a new series or part goes live elsewhere,
   add/update its entry here too.
   `url` is root-relative to docs/ ("parts/..."); null means no page exists
   yet (a "Coming soon" tile), shown in results but not clickable. */
window.DTC_SEARCH_INDEX = [

  /* Brands */
  { type: 'brand', title: 'GE Boards & Turbine Control', subtitle: '1,244 parts', url: 'parts/ge-boards-turbine-control.html', keywords: 'general electric speedtronic' },
  { type: 'brand', title: 'Bently Nevada', subtitle: '4 parts', url: null, keywords: '' },
  { type: 'brand', title: 'ABB', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Woodward', subtitle: '4 parts', url: null, keywords: '' },
  { type: 'brand', title: 'Westinghouse', subtitle: '3 parts', url: null, keywords: '' },
  { type: 'brand', title: 'Siemens', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Ovation', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Alstom', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Rolls Royce', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Allen Bradley', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Fanuc', subtitle: '1 part', url: null, keywords: '' },
  { type: 'brand', title: 'Others', subtitle: '95 parts', url: null, keywords: 'miscellaneous brands' },

  /* GE series */
  { type: 'series', title: 'Mark 1 & II', subtitle: 'GE Speedtronic · 7 parts', url: 'parts/ge-boards-turbine-control/mark-1-ii.html', keywords: 'mark i mark 1 mark ii ge speedtronic' },
  { type: 'series', title: 'Mark IV', subtitle: 'GE Speedtronic · 6 parts', url: 'parts/ge-boards-turbine-control/mark-iv.html', keywords: 'mark 4 ge speedtronic' },
  { type: 'series', title: 'Mark V', subtitle: 'GE Speedtronic · 244 parts', url: null, keywords: 'mark 5 ge speedtronic' },
  { type: 'series', title: 'Mark VI', subtitle: 'GE Speedtronic · 353 parts', url: null, keywords: 'mark 6 ge speedtronic' },
  { type: 'series', title: 'Mark VIe', subtitle: 'GE Speedtronic · 406 parts', url: null, keywords: 'mark 6e mark vie ge speedtronic' },
  { type: 'series', title: 'EX2000', subtitle: 'GE excitation · 90 parts', url: null, keywords: 'ex2000 excitation ge' },
  { type: 'series', title: 'EX2100 & E', subtitle: 'GE excitation · 51 parts', url: null, keywords: 'ex2100 ex2100e excitation ge' },
  { type: 'series', title: 'GE Others', subtitle: 'GE Speedtronic · 100 parts', url: null, keywords: 'ge other boards' },

  /* Mark 1 & II parts */
  { type: 'part', title: '259B2451BVP4', subtitle: 'Mark 1 & II · ESWA 8P / ESWB 16P universal DIN rail adapter bracket, zinc, blue RoHS', url: 'parts/259b2451bvp4.html', keywords: 'din rail adapter bracket eswa eswb' },
  { type: 'part', title: '259B2451BVP2', subtitle: 'Mark 1 & II · ESWA 8P QUINT PS power supply unit, 480W capacity, with bracket assembly', url: 'parts/259b2451bvp2.html', keywords: 'power supply quint ps' },
  { type: 'part', title: '259B2451BVP1', subtitle: 'Mark 1 & II · Universal DIN rail adapter bracket, zinc, blue RoHS', url: 'parts/259b2451bvp1.html', keywords: 'din rail adapter bracket' },
  { type: 'part', title: '259B2451FCG05', subtitle: 'Mark 1 & II board', url: 'parts/259b2451fcg05.html', keywords: '' },
  { type: 'part', title: 'IC3600VANA1G1E', subtitle: 'Mark 1 & II board', url: 'parts/ic3600vana1g1e.html', keywords: '' },
  { type: 'part', title: 'IC3600SVDC1D', subtitle: 'Mark 1 & II · Mark II Vibration Detector Board', url: 'parts/ic3600svdc1d.html', keywords: 'vibration detector' },
  { type: 'part', title: 'IC3600EPSU1P1F', subtitle: 'Mark 1 & II · Mark II Power Supply Driver Board', url: 'parts/ic3600epsu1p1f.html', keywords: 'power supply driver' },

  /* Mark IV parts */
  { type: 'part', title: 'DS3800HMPG1D1B', subtitle: 'Mark IV · Processor card', url: 'parts/ds3800hmpg1d1b.html', keywords: 'processor card' },
  { type: 'part', title: 'DS3800HMPG1D1D', subtitle: 'Mark IV · Processor card', url: 'parts/ds3800hmpg1d1d.html', keywords: 'processor card' },
  { type: 'part', title: 'DS3800HMPG1D1M', subtitle: 'Mark IV · Processor card', url: 'parts/ds3800hmpg1d1m.html', keywords: 'processor card' },
  { type: 'part', title: 'DS3800HPRB1D1C', subtitle: 'Mark IV · Pulse rate input board', url: 'parts/ds3800hprb1d1c.html', keywords: 'pulse rate input' },
  { type: 'part', title: 'DS3800NGDD', subtitle: 'Mark IV · Field ground detector card', url: 'parts/ds3800ngdd.html', keywords: 'field ground detector' },
  { type: 'part', title: 'DS3800NGDD1C', subtitle: 'Mark IV · Field ground detector card', url: 'parts/ds3800ngdd1c.html', keywords: 'field ground detector' }
];
