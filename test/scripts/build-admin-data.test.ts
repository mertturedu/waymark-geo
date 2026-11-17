import { PROVINCE_ALIASES, buildAdminData, crossCheck, officialDistrict, renderReport, type AdminRow } from '../../scripts/build-admin-data';

const row = (over: Partial<AdminRow> & Pick<AdminRow, 'id' | 'level'>): AdminRow => ({ iso: null, names: { tr: 'x' }, alt: [], bbox: [0, 0, 1, 1], wkt: '', parent: null, ...over });

const rows: AdminRow[] = [
  row({ id: 'r1', level: 4, iso: 'TR-34', names: { tr: 'İstanbul', en: 'Istanbul', ru: 'Стамбул' } }),
  row({ id: 'r2', level: 4, iso: 'TR-06', names: { tr: 'Ankara', en: 'Ankara', ru: 'Анкара', de: 'Ankara' } }),
  row({ id: 'r3', level: 4, iso: 'SY-HK', names: { tr: 'Hasakah' } }),
  row({ id: 'r10', level: 6, names: { tr: 'Kadıköy' }, parent: 'r1' }),
  row({ id: 'r11', level: 6, names: { tr: 'Üsküdar' }, alt: ['Scutari'], parent: 'r1' }),
  row({ id: 'r12', level: 6, names: { tr: 'Ankara Merkez', en: 'Ankara Central' }, parent: 'r2' }),
  row({ id: 'r13', level: 6, names: { tr: 'Çankaya' }, parent: 'r2' }),
  row({ id: 'r14', level: 6, names: { tr: 'Dışarıda' }, parent: null }),
  row({ id: 'r15', level: 6, names: { tr: 'Suriye ilçesi' }, parent: 'r3' }),
  row({ id: 'r20', level: 8, names: { tr: 'Moda Mahallesi' }, parent: 'r10' }),
];

describe('buildAdminData', () => {
  const { data, report } = buildAdminData(rows, 973);

  it('keeps only Turkish provinces, sorted by plate', () => {
    expect(data.provinces.map((p) => p.plate)).toEqual(['06', '34']);
    expect(data.provinces[1]).toEqual({ plate: '34', names: { tr: 'İstanbul', en: 'Istanbul', ru: 'Стамбул' }, alt: [] });
  });

  it('adds the everyday short names to the provinces they stand for', () => {
    const withAliases = buildAdminData(
      [row({ id: 'p27', level: 4, iso: 'TR-27', names: { tr: 'Gaziantep' }, alt: ['Antep'] }), row({ id: 'p46', level: 4, iso: 'TR-46', names: { tr: 'Kahramanmaraş' } }), row({ id: 'p63', level: 4, iso: 'TR-63', names: { tr: 'Şanlıurfa' } })],
      0,
    ).data.provinces;
    expect(withAliases.map((p) => p.alt)).toEqual([['Antep'], ['Maraş'], ['Urfa']]);
    expect(PROVINCE_ALIASES).toEqual({ '03': ['Afyon'], '27': ['Antep'], '33': ['İçel'], '46': ['Maraş'], '63': ['Urfa'] });
  });

  it('keeps districts whose parent is a Turkish province, sorted by plate and name', () => {
    expect(data.districts.map((d) => `${d.province}/${d.names.tr}`)).toEqual(['06/Çankaya', '06/Merkez', '34/Kadıköy', '34/Üsküdar']);
  });

  it('turns "<province> Merkez" into Merkez with the long name as an alternative', () => {
    const merkez = data.districts.find((d) => d.names.tr === 'Merkez');
    expect(merkez).toEqual({ province: '06', names: { tr: 'Merkez', en: 'Ankara Central' }, alt: ['Ankara Merkez'] });
  });

  it('keeps alternative names', () => {
    expect(data.districts.find((d) => d.names.tr === 'Üsküdar')?.alt).toEqual(['Scutari']);
  });

  it('counts what it dropped and what is missing', () => {
    expect(report.districtCount).toBe(4);
    expect(report.expectedDistricts).toBe(973);
    expect(report.districtDelta).toBe(4 - 973);
    expect(report.droppedDistricts.map((d) => d.id)).toEqual(['r14', 'r15']);
    expect(report.missingPlates).toHaveLength(79);
    expect(report.languageGaps).toMatchObject({ en: 0, ru: 0, de: 1, el: 2, ar: 2 });
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildAdminData([...rows].reverse(), 973).data)).toBe(JSON.stringify(data));
  });
});

describe('crossCheck', () => {
  const { data } = buildAdminData(rows, 973);
  const external = {
    İSTANBUL: { plaka: 34, ilceler: { Kadıköy: [], Üsküdar: [], Adalar: [] } },
    ANKARA: { plaka: 6, ilceler: { Merkez: [], Çankaya: [], Etimesgut: [] } },
  };

  it('lists districts only one side has', () => {
    const result = crossCheck(data, external);
    expect(result.onlyExternal).toEqual([
      { plate: '06', name: 'Etimesgut' },
      { plate: '34', name: 'Adalar' },
    ]);
    expect(result.onlyOsm).toEqual([]);
    expect(result.externalCount).toBe(6);
  });

  it('reports districts that OpenStreetMap has and the other list does not', () => {
    const result = crossCheck(data, { İSTANBUL: { plaka: 34, ilceler: { Kadıköy: [] } } });
    expect(result.onlyOsm).toEqual([{ plate: '34', name: 'Üsküdar' }]);
    expect(result.missingProvinces).toEqual(['06']);
  });
});

describe('renderReport', () => {
  it('writes the numbers a reader needs', () => {
    const { report } = buildAdminData(rows, 973);
    const text = renderReport(report, null);
    expect(text).toContain('973');
    expect(text).toContain('Dışarıda');
    expect(text).toContain('karşılaştırılmadı');
  });
});

describe('official names', () => {
  const fixRows: AdminRow[] = [
    row({ id: 'p1', level: 4, iso: 'TR-05', names: { tr: 'Amasya' } }),
    row({ id: 'p2', level: 4, iso: 'TR-04', names: { tr: 'Ağrı' } }),
    row({ id: 'p3', level: 4, iso: 'TR-48', names: { tr: 'Muğla' } }),
    row({ id: 'p4', level: 4, iso: 'TR-45', names: { tr: 'Manisa' } }),
    row({ id: 'd1', level: 6, names: { tr: 'Amasya' }, parent: 'p1' }),
    row({ id: 'd2', level: 6, names: { tr: 'Taşova' }, parent: 'p1' }),
    row({ id: 'd3', level: 6, names: { tr: 'Panos' }, parent: 'p2' }),
    row({ id: 'd4', level: 6, names: { tr: 'Kara Ada' }, parent: 'p3' }),
    row({ id: 'd5', level: 6, names: { tr: 'Yunus Emre' }, parent: 'p4' }),
  ];
  const { data, report } = buildAdminData(fixRows, 973);

  it('calls a district that carries its province name Merkez', () => {
    expect(data.districts.find((d) => d.province === '05' && d.names.tr === 'Merkez')).toEqual({ province: '05', names: { tr: 'Merkez' }, alt: ['Amasya'] });
    expect(data.districts.find((d) => d.names.tr === 'Taşova')).toBeDefined();
  });

  it('corrects the known OpenStreetMap spellings and keeps the old one as an alternative', () => {
    expect(data.districts.find((d) => d.province === '04')).toEqual({ province: '04', names: { tr: 'Patnos' }, alt: ['Panos'] });
    expect(data.districts.find((d) => d.province === '45')).toEqual({ province: '45', names: { tr: 'Yunusemre' }, alt: ['Yunus Emre'] });
  });

  it('lists every renaming in the report', () => {
    expect(report.corrections).toEqual(
      expect.arrayContaining([
        { plate: '05', from: 'Amasya', to: 'Merkez' },
        { plate: '04', from: 'Panos', to: 'Patnos' },
        { plate: '45', from: 'Yunus Emre', to: 'Yunusemre' },
      ]),
    );
    expect(renderReport(report, null)).toContain('04 Panos -> Patnos');
  });

  it('drops a polygon that is not an official district and says why', () => {
    expect(data.districts.some((d) => d.province === '48')).toBe(false);
    expect(report.droppedDistricts).toContainEqual({ id: 'd4', name: 'Kara Ada', reason: 'resmi listede yok' });
  });
});

describe('officialDistrict', () => {
  it.each([
    ['34', 'Kadıköy', 'İstanbul', { name: 'Kadıköy', alt: [] }],
    ['05', 'Amasya', 'Amasya', { name: 'Merkez', alt: ['Amasya'] }],
    ['06', 'Ankara Merkez', 'Ankara', { name: 'Merkez', alt: ['Ankara Merkez'] }],
    ['04', 'Panos', 'Ağrı', { name: 'Patnos', alt: ['Panos'] }],
    ['48', 'Kara Ada', 'Muğla', null],
  ])('%s %s -> %j', (plate, name, province, expected) => {
    expect(officialDistrict(plate, name, province)).toEqual(expected);
  });
});

describe('district names from OpenStreetMap that are not reliable', () => {
  const fixRows: AdminRow[] = [
    row({ id: 'p1', level: 4, iso: 'TR-17', names: { tr: 'Çanakkale', de: 'Dardanellen' } }),
    row({ id: 'p2', level: 4, iso: 'TR-18', names: { tr: 'Çankırı' } }),
    row({ id: 'p3', level: 4, iso: 'TR-51', names: { tr: 'Niğde' } }),
    row({ id: 'p4', level: 4, iso: 'TR-23', names: { tr: 'Elazığ' } }),
    row({ id: 'd1', level: 6, names: { tr: 'Çan', de: 'Çankırı', en: 'Can' }, parent: 'p1' }),
    row({ id: 'd2', level: 6, names: { tr: 'Çamardı' }, alt: ['Maden'], parent: 'p3' }),
    row({ id: 'd3', level: 6, names: { tr: 'Maden' }, parent: 'p4' }),
  ];
  const { data } = buildAdminData(fixRows, 973);

  it('drops German district names, which are often wrong', () => {
    expect(data.districts.find((d) => d.names.tr === 'Çan')?.names).toEqual({ tr: 'Çan', en: 'Can' });
    expect(data.provinces.find((p) => p.plate === '17')?.names.de).toBe('Dardanellen');
  });

  it('drops an alternative name that is another district', () => {
    expect(data.districts.find((d) => d.names.tr === 'Çamardı')?.alt).toEqual([]);
  });

  it('drops the known alternative names that are neighbourhood names', () => {
    const rows2: AdminRow[] = [
      row({ id: 'p1', level: 4, iso: 'TR-32', names: { tr: 'Isparta' } }),
      row({ id: 'd1', level: 6, names: { tr: 'Şarkikaraağaç' }, alt: ['Karaağaç', 'Şarki Karaağaç'], parent: 'p1' }),
    ];
    expect(buildAdminData(rows2, 973).data.districts[0]?.alt).toEqual(['Şarki Karaağaç']);
  });
});
