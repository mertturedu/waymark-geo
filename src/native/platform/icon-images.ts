/// <reference path="./assets.d.ts" />
import food from '../map/icons/geo-food.png';
import fuel from '../map/icons/geo-fuel.png';
import health from '../map/icons/geo-health.png';
import lodging from '../map/icons/geo-lodging.png';
import market from '../map/icons/geo-market.png';
import money from '../map/icons/geo-money.png';
import pharmacy from '../map/icons/geo-pharmacy.png';
import publicPlace from '../map/icons/geo-public.png';
import safety from '../map/icons/geo-safety.png';
import shop from '../map/icons/geo-shop.png';
import worship from '../map/icons/geo-worship.png';
import landmark from '../map/icons/geo-landmark.png';
import brand_a101 from '../map/icons/geo-brand-a101.png';
import brand_bim from '../map/icons/geo-brand-bim.png';
import brand_sok from '../map/icons/geo-brand-sok.png';
import brand_migros from '../map/icons/geo-brand-migros.png';
import brand_carrefoursa from '../map/icons/geo-brand-carrefoursa.png';
import brand_macro from '../map/icons/geo-brand-macro.png';
import brand_file from '../map/icons/geo-brand-file.png';
import brand_hakmar from '../map/icons/geo-brand-hakmar.png';
import brand_kipa from '../map/icons/geo-brand-kipa.png';
import brand_bizim from '../map/icons/geo-brand-bizim.png';
import brand_metro from '../map/icons/geo-brand-metro.png';
import brand_tekzen from '../map/icons/geo-brand-tekzen.png';
import brand_koctas from '../map/icons/geo-brand-koctas.png';
import brand_bauhaus from '../map/icons/geo-brand-bauhaus.png';
import brand_teknosa from '../map/icons/geo-brand-teknosa.png';
import brand_mediamarkt from '../map/icons/geo-brand-mediamarkt.png';
import brand_vatan from '../map/icons/geo-brand-vatan.png';
import brand_gratis from '../map/icons/geo-brand-gratis.png';
import brand_watsons from '../map/icons/geo-brand-watsons.png';
import brand_rossmann from '../map/icons/geo-brand-rossmann.png';
import brand_lcw from '../map/icons/geo-brand-lcw.png';
import brand_defacto from '../map/icons/geo-brand-defacto.png';
import brand_koton from '../map/icons/geo-brand-koton.png';
import brand_flo from '../map/icons/geo-brand-flo.png';
import brand_vodafone from '../map/icons/geo-brand-vodafone.png';
import brand_turkcell from '../map/icons/geo-brand-turkcell.png';
import brand_turktelekom from '../map/icons/geo-brand-turktelekom.png';
import brand_opet from '../map/icons/geo-brand-opet.png';
import brand_shell from '../map/icons/geo-brand-shell.png';
import brand_bp from '../map/icons/geo-brand-bp.png';
import brand_po from '../map/icons/geo-brand-po.png';
import brand_total from '../map/icons/geo-brand-total.png';
import brand_aytemiz from '../map/icons/geo-brand-aytemiz.png';
import brand_lukoil from '../map/icons/geo-brand-lukoil.png';
import brand_kadoil from '../map/icons/geo-brand-kadoil.png';
import brand_starbucks from '../map/icons/geo-brand-starbucks.png';
import brand_mcdonalds from '../map/icons/geo-brand-mcdonalds.png';
import brand_burgerking from '../map/icons/geo-brand-burgerking.png';
import brand_dominos from '../map/icons/geo-brand-dominos.png';
import brand_kfc from '../map/icons/geo-brand-kfc.png';
import brand_popeyes from '../map/icons/geo-brand-popeyes.png';
import brand_komagene from '../map/icons/geo-brand-komagene.png';
import brand_kahvedunyasi from '../map/icons/geo-brand-kahvedunyasi.png';
import brand_simitsarayi from '../map/icons/geo-brand-simitsarayi.png';
import brand_mado from '../map/icons/geo-brand-mado.png';
import brand_isbank from '../map/icons/geo-brand-isbank.png';
import brand_ziraat from '../map/icons/geo-brand-ziraat.png';
import brand_halkbank from '../map/icons/geo-brand-halkbank.png';
import brand_garanti from '../map/icons/geo-brand-garanti.png';
import brand_akbank from '../map/icons/geo-brand-akbank.png';
import brand_yapikredi from '../map/icons/geo-brand-yapikredi.png';
import brand_vakifbank from '../map/icons/geo-brand-vakifbank.png';
import brand_qnb from '../map/icons/geo-brand-qnb.png';
import brand_denizbank from '../map/icons/geo-brand-denizbank.png';
import brand_teb from '../map/icons/geo-brand-teb.png';
import brand_kuveytturk from '../map/icons/geo-brand-kuveytturk.png';
import brand_yurtici from '../map/icons/geo-brand-yurtici.png';
import brand_aras from '../map/icons/geo-brand-aras.png';
import brand_mng from '../map/icons/geo-brand-mng.png';
import brand_ptt from '../map/icons/geo-brand-ptt.png';
import brand_surat from '../map/icons/geo-brand-surat.png';
import brand_hepsijet from '../map/icons/geo-brand-hepsijet.png';
import brand_trendyolexpress from '../map/icons/geo-brand-trendyolexpress.png';
import brand_ups from '../map/icons/geo-brand-ups.png';
import brand_dhl from '../map/icons/geo-brand-dhl.png';
import cargo from '../map/icons/geo-cargo.png';
import sdf_cargo from '../map/icons/geo-sdf-cargo.png';
import sdf_food from '../map/icons/geo-sdf-food.png';
import sdf_fuel from '../map/icons/geo-sdf-fuel.png';
import sdf_health from '../map/icons/geo-sdf-health.png';
import sdf_landmark from '../map/icons/geo-sdf-landmark.png';
import sdf_lodging from '../map/icons/geo-sdf-lodging.png';
import sdf_market from '../map/icons/geo-sdf-market.png';
import sdf_money from '../map/icons/geo-sdf-money.png';
import sdf_pharmacy from '../map/icons/geo-sdf-pharmacy.png';
import sdf_public from '../map/icons/geo-sdf-public.png';
import sdf_safety from '../map/icons/geo-sdf-safety.png';
import sdf_shop from '../map/icons/geo-sdf-shop.png';
import sdf_worship from '../map/icons/geo-sdf-worship.png';
import sdf_badge from '../map/icons/geo-sdf-badge.png';
import sdf_badge_rounded from '../map/icons/geo-sdf-badge-rounded.png';

import { BADGE_IMAGES } from './badge-images';
import { SHIELD_ICON_IMAGES } from './shield-images';

export type MapIconImage = number | { source: number; sdf: true };

export const MAP_ICON_IMAGES: Record<string, MapIconImage> = {
  'geo-food': food,
  'geo-fuel': fuel,
  'geo-health': health,
  'geo-lodging': lodging,
  'geo-market': market,
  'geo-money': money,
  'geo-pharmacy': pharmacy,
  'geo-public': publicPlace,
  'geo-safety': safety,
  'geo-shop': shop,
  'geo-worship': worship,
  'geo-landmark': landmark,
  'geo-brand-a101': brand_a101,
  'geo-brand-bim': brand_bim,
  'geo-brand-sok': brand_sok,
  'geo-brand-migros': brand_migros,
  'geo-brand-carrefoursa': brand_carrefoursa,
  'geo-brand-macro': brand_macro,
  'geo-brand-file': brand_file,
  'geo-brand-hakmar': brand_hakmar,
  'geo-brand-kipa': brand_kipa,
  'geo-brand-bizim': brand_bizim,
  'geo-brand-metro': brand_metro,
  'geo-brand-tekzen': brand_tekzen,
  'geo-brand-koctas': brand_koctas,
  'geo-brand-bauhaus': brand_bauhaus,
  'geo-brand-teknosa': brand_teknosa,
  'geo-brand-mediamarkt': brand_mediamarkt,
  'geo-brand-vatan': brand_vatan,
  'geo-brand-gratis': brand_gratis,
  'geo-brand-watsons': brand_watsons,
  'geo-brand-rossmann': brand_rossmann,
  'geo-brand-lcw': brand_lcw,
  'geo-brand-defacto': brand_defacto,
  'geo-brand-koton': brand_koton,
  'geo-brand-flo': brand_flo,
  'geo-brand-vodafone': brand_vodafone,
  'geo-brand-turkcell': brand_turkcell,
  'geo-brand-turktelekom': brand_turktelekom,
  'geo-brand-opet': brand_opet,
  'geo-brand-shell': brand_shell,
  'geo-brand-bp': brand_bp,
  'geo-brand-po': brand_po,
  'geo-brand-total': brand_total,
  'geo-brand-aytemiz': brand_aytemiz,
  'geo-brand-lukoil': brand_lukoil,
  'geo-brand-kadoil': brand_kadoil,
  'geo-brand-starbucks': brand_starbucks,
  'geo-brand-mcdonalds': brand_mcdonalds,
  'geo-brand-burgerking': brand_burgerking,
  'geo-brand-dominos': brand_dominos,
  'geo-brand-kfc': brand_kfc,
  'geo-brand-popeyes': brand_popeyes,
  'geo-brand-komagene': brand_komagene,
  'geo-brand-kahvedunyasi': brand_kahvedunyasi,
  'geo-brand-simitsarayi': brand_simitsarayi,
  'geo-brand-mado': brand_mado,
  'geo-brand-isbank': brand_isbank,
  'geo-brand-ziraat': brand_ziraat,
  'geo-brand-halkbank': brand_halkbank,
  'geo-brand-garanti': brand_garanti,
  'geo-brand-akbank': brand_akbank,
  'geo-brand-yapikredi': brand_yapikredi,
  'geo-brand-vakifbank': brand_vakifbank,
  'geo-brand-qnb': brand_qnb,
  'geo-brand-denizbank': brand_denizbank,
  'geo-brand-teb': brand_teb,
  'geo-brand-kuveytturk': brand_kuveytturk,
  'geo-cargo': cargo,
  'geo-brand-yurtici': brand_yurtici,
  'geo-brand-aras': brand_aras,
  'geo-brand-mng': brand_mng,
  'geo-brand-ptt': brand_ptt,
  'geo-brand-surat': brand_surat,
  'geo-brand-hepsijet': brand_hepsijet,
  'geo-brand-trendyolexpress': brand_trendyolexpress,
  'geo-brand-ups': brand_ups,
  'geo-brand-dhl': brand_dhl,
  'geo-sdf-cargo': { source: sdf_cargo, sdf: true },
  'geo-sdf-food': { source: sdf_food, sdf: true },
  'geo-sdf-fuel': { source: sdf_fuel, sdf: true },
  'geo-sdf-health': { source: sdf_health, sdf: true },
  'geo-sdf-landmark': { source: sdf_landmark, sdf: true },
  'geo-sdf-lodging': { source: sdf_lodging, sdf: true },
  'geo-sdf-market': { source: sdf_market, sdf: true },
  'geo-sdf-money': { source: sdf_money, sdf: true },
  'geo-sdf-pharmacy': { source: sdf_pharmacy, sdf: true },
  'geo-sdf-public': { source: sdf_public, sdf: true },
  'geo-sdf-safety': { source: sdf_safety, sdf: true },
  'geo-sdf-shop': { source: sdf_shop, sdf: true },
  'geo-sdf-worship': { source: sdf_worship, sdf: true },
  'geo-sdf-badge': { source: sdf_badge, sdf: true },
  'geo-sdf-badge-rounded': { source: sdf_badge_rounded, sdf: true },
  ...BADGE_IMAGES,
  ...SHIELD_ICON_IMAGES,
};
