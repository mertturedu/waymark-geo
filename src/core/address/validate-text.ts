import type { Lang } from '../text/types';
import type { Precision } from './types';

export type NoteCode =
  | 'missing_neighbourhood'
  | 'missing_number'
  | 'district_mismatch'
  | 'street_not_in_neighbourhood'
  | 'number_out_of_range'
  | 'number_not_on_street'
  | 'parity_side_unknown'
  | 'ambiguous_street'
  | 'outside_installed_regions'
  | 'block_not_found'
  | 'floor_out_of_range'
  | 'door_out_of_range'
  | 'floor_door_mismatch'
  | 'landmark_not_in_building'
  | 'relation_not_found'
  | 'postcode_mismatch';

export type ValidationStatus = 'ok' | 'incomplete' | 'conflict' | 'not_found';

export const NOTE_CODES: readonly NoteCode[] = ['missing_neighbourhood', 'missing_number', 'district_mismatch', 'street_not_in_neighbourhood', 'number_out_of_range', 'number_not_on_street', 'parity_side_unknown', 'ambiguous_street', 'outside_installed_regions', 'block_not_found', 'floor_out_of_range', 'door_out_of_range', 'floor_door_mismatch', 'landmark_not_in_building', 'relation_not_found', 'postcode_mismatch'];

export const PRECISIONS: readonly Precision[] = ['address', 'interpolated', 'street', 'neighbourhood', 'district', 'province', 'poi'];
export const STATUSES: readonly ValidationStatus[] = ['ok', 'incomplete', 'conflict', 'not_found'];

type Messages = Record<NoteCode, string>;

const NOTES: Record<Lang, Messages> = {
  tr: {
    missing_neighbourhood: 'Mahalle yazılmamış; bu sokak birden fazla mahallede var.',
    missing_number: 'Kapı numarası yazılmamış.',
    district_mismatch: 'Yazılan ilçe ({given}) ile adres uyuşmuyor; adres {found} ilçesinde bulundu.',
    street_not_in_neighbourhood: 'Bu sokak {given} mahallesinde bulunamadı; {found} mahallesinde var.',
    number_out_of_range: 'Bu kapı numarası sokağın bilinen numaralarının dışında.',
    number_not_on_street: 'Bu kapı numarası bu sokakta bulunamadı.',
    parity_side_unknown: 'Numaranın sokağın hangi tarafında olduğu bilinmiyor; nokta yaklaşıktır.',
    ambiguous_street: 'Bu adla birden fazla sokak var; mahalle ya da ilçe yazın.',
    outside_installed_regions: 'Bu adres için gerekli bölge cihazda kurulu değil.',
    block_not_found: 'Yazılan blok sitede bulunamadı.',
    floor_out_of_range: 'Bu bina bu kadar katlı görünmüyor.',
    door_out_of_range: 'Bu daire numarası binaya göre çok büyük.',
    floor_door_mismatch: 'Kat ile daire numarası birbirini tutmuyor.',
    landmark_not_in_building: 'Yer işareti bir binayla eşleşmedi; yer işaretinin kendisi gösterildi.',
    relation_not_found: 'Yer işaretine göre bir bina bulunamadı; yer işaretinin kendisi gösterildi.',
    postcode_mismatch: 'Yazılan posta kodu ({given}) bu mahalleyle uyuşmuyor; mahallenin posta kodu {found}.',
  },
  en: {
    missing_neighbourhood: 'No neighbourhood was given; this street exists in more than one.',
    missing_number: 'The house number is missing.',
    district_mismatch: 'The district you wrote ({given}) does not match; the address was found in {found}.',
    street_not_in_neighbourhood: 'This street was not found in {given}; it exists in {found}.',
    number_out_of_range: 'This house number is outside the known numbers of the street.',
    number_not_on_street: 'This house number was not found on this street.',
    parity_side_unknown: 'The side of the street for this number is unknown; the point is approximate.',
    ambiguous_street: 'More than one street has this name; add the neighbourhood or district.',
    outside_installed_regions: 'The region for this address is not installed on the device.',
    block_not_found: 'The block you wrote was not found in the complex.',
    floor_out_of_range: 'This building does not seem to have that many floors.',
    door_out_of_range: 'This flat number is too large for the building.',
    floor_door_mismatch: 'The floor and the flat number do not agree.',
    landmark_not_in_building: 'The landmark did not match a building; the landmark itself is shown.',
    relation_not_found: 'No building was found relative to the landmark; the landmark itself is shown.',
    postcode_mismatch: 'The postcode you wrote ({given}) does not match this neighbourhood; its postcode is {found}.',
  },
  de: {
    missing_neighbourhood: 'Es wurde kein Stadtviertel angegeben; diese Straße gibt es in mehreren.',
    missing_number: 'Die Hausnummer fehlt.',
    district_mismatch: 'Der angegebene Bezirk ({given}) passt nicht; die Adresse liegt in {found}.',
    street_not_in_neighbourhood: 'Diese Straße wurde in {given} nicht gefunden; sie liegt in {found}.',
    number_out_of_range: 'Diese Hausnummer liegt außerhalb der bekannten Nummern der Straße.',
    number_not_on_street: 'Diese Hausnummer wurde in dieser Straße nicht gefunden.',
    parity_side_unknown: 'Die Straßenseite dieser Nummer ist unbekannt; der Punkt ist ungefähr.',
    ambiguous_street: 'Mehrere Straßen heißen so; geben Sie Viertel oder Bezirk an.',
    outside_installed_regions: 'Die Region für diese Adresse ist auf dem Gerät nicht installiert.',
    block_not_found: 'Der angegebene Block wurde in der Anlage nicht gefunden.',
    floor_out_of_range: 'Dieses Gebäude scheint nicht so viele Stockwerke zu haben.',
    door_out_of_range: 'Diese Wohnungsnummer ist für das Gebäude zu groß.',
    floor_door_mismatch: 'Stockwerk und Wohnungsnummer passen nicht zusammen.',
    landmark_not_in_building: 'Der Orientierungspunkt passte zu keinem Gebäude; er selbst wird angezeigt.',
    relation_not_found: 'Zum Orientierungspunkt wurde kein Gebäude gefunden; er selbst wird angezeigt.',
    postcode_mismatch: 'Die angegebene Postleitzahl ({given}) passt nicht zum Viertel; die Postleitzahl des Viertels ist {found}.',
  },
  ar: {
    missing_neighbourhood: 'لم يُكتب اسم الحي؛ هذا الشارع موجود في أكثر من حي.',
    missing_number: 'رقم المبنى غير مكتوب.',
    district_mismatch: 'المنطقة المكتوبة ({given}) لا تطابق العنوان؛ وُجد العنوان في {found}.',
    street_not_in_neighbourhood: 'لم يُعثر على هذا الشارع في {given}؛ هو موجود في {found}.',
    number_out_of_range: 'رقم المبنى هذا خارج أرقام الشارع المعروفة.',
    number_not_on_street: 'لم يتم العثور على رقم المبنى هذا في هذا الشارع.',
    parity_side_unknown: 'جانب الشارع لهذا الرقم غير معروف؛ النقطة تقريبية.',
    ambiguous_street: 'يوجد أكثر من شارع بهذا الاسم؛ اكتب الحي أو المنطقة.',
    outside_installed_regions: 'المنطقة الخاصة بهذا العنوان غير مثبّتة على الجهاز.',
    block_not_found: 'لم يُعثر على المبنى المكتوب في المجمع.',
    floor_out_of_range: 'لا يبدو أن هذا المبنى فيه هذا العدد من الطوابق.',
    door_out_of_range: 'رقم الشقة هذا كبير جدًا بالنسبة للمبنى.',
    floor_door_mismatch: 'الطابق ورقم الشقة لا يتطابقان.',
    landmark_not_in_building: 'لم تطابق العلامة أي مبنى؛ تُعرض العلامة نفسها.',
    relation_not_found: 'لم يُعثر على مبنى بالنسبة للعلامة؛ تُعرض العلامة نفسها.',
    postcode_mismatch: 'الرمز البريدي المكتوب ({given}) لا يطابق هذا الحي؛ الرمز البريدي للحي هو {found}.',
  },
  ru: {
    missing_neighbourhood: 'Район не указан; такая улица есть в нескольких районах.',
    missing_number: 'Не указан номер дома.',
    district_mismatch: 'Указанный округ ({given}) не совпадает; адрес найден в округе {found}.',
    street_not_in_neighbourhood: 'Эта улица не найдена в районе {given}; она есть в районе {found}.',
    number_out_of_range: 'Этот номер дома вне известных номеров улицы.',
    number_not_on_street: 'Номер дома не найден на этой улице.',
    parity_side_unknown: 'Сторона улицы для этого номера неизвестна; точка приблизительная.',
    ambiguous_street: 'Улиц с таким названием несколько; укажите район или округ.',
    outside_installed_regions: 'Регион для этого адреса не установлен на устройстве.',
    block_not_found: 'Указанный корпус в комплексе не найден.',
    floor_out_of_range: 'В этом здании, похоже, нет столько этажей.',
    door_out_of_range: 'Номер квартиры слишком велик для этого здания.',
    floor_door_mismatch: 'Этаж и номер квартиры не согласуются.',
    landmark_not_in_building: 'Ориентир не совпал со зданием; показан сам ориентир.',
    relation_not_found: 'Здание относительно ориентира не найдено; показан сам ориентир.',
    postcode_mismatch: 'Указанный почтовый индекс ({given}) не соответствует району; индекс района — {found}.',
  },
  el: {
    missing_neighbourhood: 'Δεν δόθηκε γειτονιά· ο δρόμος υπάρχει σε περισσότερες από μία.',
    missing_number: 'Λείπει ο αριθμός.',
    district_mismatch: 'Ο δήμος που γράψατε ({given}) δεν ταιριάζει· η διεύθυνση βρέθηκε στον {found}.',
    street_not_in_neighbourhood: 'Ο δρόμος δεν βρέθηκε στη γειτονιά {given}· υπάρχει στη {found}.',
    number_out_of_range: 'Ο αριθμός αυτός είναι εκτός των γνωστών αριθμών του δρόμου.',
    number_not_on_street: 'Ο αριθμός δεν βρέθηκε σε αυτόν τον δρόμο.',
    parity_side_unknown: 'Η πλευρά του δρόμου για τον αριθμό είναι άγνωστη· το σημείο είναι προσεγγιστικό.',
    ambiguous_street: 'Περισσότεροι από ένας δρόμοι έχουν αυτό το όνομα· προσθέστε γειτονιά ή δήμο.',
    outside_installed_regions: 'Η περιοχή αυτής της διεύθυνσης δεν είναι εγκατεστημένη στη συσκευή.',
    block_not_found: 'Το κτίριο που γράψατε δεν βρέθηκε στο συγκρότημα.',
    floor_out_of_range: 'Το κτίριο δεν φαίνεται να έχει τόσους ορόφους.',
    door_out_of_range: 'Ο αριθμός διαμερίσματος είναι πολύ μεγάλος για το κτίριο.',
    floor_door_mismatch: 'Ο όροφος και ο αριθμός διαμερίσματος δεν ταιριάζουν.',
    landmark_not_in_building: 'Το σημείο αναφοράς δεν ταίριαξε με κτίριο· εμφανίζεται το ίδιο το σημείο.',
    relation_not_found: 'Δεν βρέθηκε κτίριο σε σχέση με το σημείο αναφοράς· εμφανίζεται το ίδιο το σημείο.',
    postcode_mismatch: 'Ο ταχυδρομικός κωδικός που γράψατε ({given}) δεν ταιριάζει με τη γειτονιά· ο κωδικός της είναι {found}.',
  },
};

const KINDS: Record<Lang, Record<Precision, string>> = {
  tr: { address: 'Kapı numarası', interpolated: 'Tahmini kapı', street: 'Sokak', neighbourhood: 'Mahalle', district: 'İlçe', province: 'İl', poi: 'Yer' },
  en: { address: 'House number', interpolated: 'Estimated door', street: 'Street', neighbourhood: 'Neighbourhood', district: 'District', province: 'Province', poi: 'Place' },
  de: { address: 'Hausnummer', interpolated: 'Geschätzte Tür', street: 'Straße', neighbourhood: 'Viertel', district: 'Bezirk', province: 'Provinz', poi: 'Ort' },
  ar: { address: 'رقم المبنى', interpolated: 'باب تقديري', street: 'شارع', neighbourhood: 'حي', district: 'منطقة', province: 'ولاية', poi: 'مكان' },
  ru: { address: 'Номер дома', interpolated: 'Примерный дом', street: 'Улица', neighbourhood: 'Район', district: 'Округ', province: 'Ил', poi: 'Место' },
  el: { address: 'Αριθμός', interpolated: 'Εκτιμώμενη είσοδος', street: 'Δρόμος', neighbourhood: 'Γειτονιά', district: 'Δήμος', province: 'Επαρχία', poi: 'Τόπος' },
};

const STATUS: Record<Lang, Record<ValidationStatus, string>> = {
  tr: { ok: 'Adres tutarlı', incomplete: 'Adres eksik', conflict: 'Adres çelişkili', not_found: 'Adres bulunamadı' },
  en: { ok: 'Address is consistent', incomplete: 'Address is incomplete', conflict: 'Address has a conflict', not_found: 'Address not found' },
  de: { ok: 'Adresse ist stimmig', incomplete: 'Adresse ist unvollständig', conflict: 'Adresse widerspricht sich', not_found: 'Adresse nicht gefunden' },
  ar: { ok: 'العنوان متسق', incomplete: 'العنوان ناقص', conflict: 'العنوان متناقض', not_found: 'لم يُعثر على العنوان' },
  ru: { ok: 'Адрес согласован', incomplete: 'Адрес неполный', conflict: 'Адрес противоречив', not_found: 'Адрес не найден' },
  el: { ok: 'Η διεύθυνση είναι συνεπής', incomplete: 'Η διεύθυνση είναι ελλιπής', conflict: 'Η διεύθυνση έχει αντίφαση', not_found: 'Η διεύθυνση δεν βρέθηκε' },
};

const fill = (text: string, values: { given?: string; found?: string }): string => text.replace('{given}', values.given ?? '').replace('{found}', values.found ?? '');

export const noteText = (code: NoteCode, lang: Lang, values: { given?: string; found?: string } = {}): string => fill(NOTES[lang][code], values);
export const kindText = (precision: Precision, lang: Lang): string => KINDS[lang][precision];
export const statusText = (status: ValidationStatus, lang: Lang): string => STATUS[lang][status];
