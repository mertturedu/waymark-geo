import { decodeText, detectColumns, isOpenLicense, parseCsv, streetRows, jsonTable, namedRows, titleLocation } from '../../scripts/opendata-lib';

describe('açık veri okuma', () => {
  it('açık lisansları ayırır', () => {
    expect(isOpenLicense('cc-by-4')).toBe(true);
    expect(isOpenLicense('cc-by')).toBe(true);
    expect(isOpenLicense('odc-by')).toBe(true);
    expect(isOpenLicense('ulasav-license')).toBe(false);
    expect(isOpenLicense(null)).toBe(false);
  });

  it('CSV yi tırnak ve ayırıcıya göre okur', () => {
    expect(parseCsv('A;B\n"x;y";2\n')).toEqual([['A', 'B'], ['x;y', '2']]);
    expect(parseCsv('ILCE_ADI,MAHALLE_ADI\r\nAHIRLI,"AKKİSE"\r\n')).toEqual([['ILCE_ADI', 'MAHALLE_ADI'], ['AHIRLI', 'AKKİSE']]);
  });

  it('Windows-1254 metni çözer', () => {
    expect(decodeText(Uint8Array.from([0x41, 0xdd, 0xfe]))).toBe('Aİş');
    expect(decodeText(new TextEncoder().encode('Çivril'))).toBe('Çivril');
  });

  it('sütunları adından bulur', () => {
    expect(detectColumns(['ILCE_ADI', 'MAHALLE_ADI', 'CADDESOKAK_ADI'])).toEqual({ district: 0, hood: 1, street: 2 });
    expect(detectColumns(['Mahalle Adı', 'Cadde Sayısı', 'Sokak Sayısı'])).toBeNull();
    expect(detectColumns(['MAHALLE_KODU', 'MAHALLE', 'SOKAK_ADI'])).toEqual({ district: null, hood: 1, street: 2 });
  });

  it('satırları ayıklar', () => {
    const rows = streetRows([['ILCE', 'MAHALLE', 'SOKAK'], ['Çivril', 'İğdir Mah.', '1245. Sk'], ['Çivril', '', 'X Sk'], ['Çivril', 'İğdir', '']]);
    expect(rows).toEqual([{ district: 'Çivril', hood: 'İğdir Mah.', street: '1245. Sk' }]);
  });
});

describe('mahalle başına yayımlanan sokak listeleri', () => {
  it('başlıktan ilçe ve mahalleyi okur', () => {
    expect(titleLocation('Ahmetli İlçesi Derici Mahallesi Cadde, Sokak, Bulvar, Meydan Verisi')).toEqual({ district: 'ahmetli', hood: 'derici' });
    expect(titleLocation('Kent Rehberi Sokak Mahalle Listesi')).toBeNull();
  });

  it('JSON kayıtlarını tabloya çevirir ve sokak adını türle birleştirir', () => {
    const table = jsonTable('[{"derici_mahallesi_csbm_İsimleri":"130","csbm_türü":"Sokak"},{"derici_mahallesi_csbm_İsimleri":"Atatürk","csbm_türü":"Cadde"}]');
    expect(namedRows(table, { district: 'ahmetli', hood: 'derici' }).map((r) => r.street)).toEqual(['130 Sokak', 'Atatürk Cadde']);
  });

  it('bozuk JSON için boş tablo döner', () => {
    expect(jsonTable('<html>')).toEqual([]);
  });
});
