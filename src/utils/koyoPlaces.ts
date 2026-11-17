/**
 * 雇用保険適用事業所（雇用保険の届書を出す単位）と、労働保険の事業（年度更新の単位）を、会社設定と拠点（支店）から決める
 * ・雇用保険適用事業所：拠点に、会社と違う雇用保険適用事業所番号が入っていれば、その拠点は別の適用事業所（届書のファイルも別）。
 *   入っていなければ会社（本店）の適用事業所。届書を出すハローワークも、拠点に入っていなければ会社の設定
 * ・労働保険の事業：拠点に、会社と違う労働保険番号が入っていれば別の事業（年度更新の申告書も別）。労災保険の事業の種類と率も、
 *   拠点に入っていなければ会社の設定
 */
import type { KoyoOffice } from "./koyoCsv";
import { splitKoyoNumber } from "./koyoCsv";
import type { KoyoPlace } from "./koyoReport";

export interface LaborCompany {
  name?: string | null;
  zip_code?: string | null;
  address?: string | null;
  phone?: string | null;
  representative?: string | null;
  shaho_office_symbol?: string | null;
  shaho_office_number?: string | null;
  labor_ins_num?: string | null;
  koyo_office_number?: string | null;
  koyo_hello_work?: string | null;
  koyo_media_seq?: number | null;
  rousai_business?: string | null;
  rousai_rate?: number | null;
  nendo_koshin?: string | null;
  default_emp_ins_type?: string | null;
}

export interface LaborBranch {
  id: number;
  name: string;
  zip_code?: string | null;
  prefecture?: string | null;
  address?: string | null;
  phone?: string | null;
  labor_ins_num?: string | null;
  koyo_office_number?: string | null;
  koyo_hello_work?: string | null;
  rousai_business?: string | null;
  rousai_rate?: number | null;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? "").normalize("NFKC").replace(/\D/g, "") === String(b ?? "").normalize("NFKC").replace(/\D/g, "");
const str = (v: unknown) => String(v ?? "").trim();
/** 本店（拠点の1番目） */
const headOf = (branches: LaborBranch[]) => branches.find((b) => b.id === 1) ?? branches[0];

/** 会社（本店）の雇用保険適用事業所 */
export const companyPlace = (company: LaborCompany, branches: LaborBranch[]): KoyoPlace => {
  const head = headOf(branches);
  return {
    key: "company", name: str(company.name), koyoNumber: str(company.koyo_office_number), helloWork: str(company.koyo_hello_work),
    prefecture: str(head?.prefecture), zip: str(company.zip_code), address: str(company.address), phone: str(company.phone),
  };
};

/** 従業員の拠点の雇用保険適用事業所 */
export const koyoPlaceOf = (company: LaborCompany, branches: LaborBranch[], branchId: unknown): KoyoPlace => {
  const b = branches.find((x) => x.id === Number(branchId || 1));
  if (!b || b.id === 1 || !str(b.koyo_office_number) || same(b.koyo_office_number, company.koyo_office_number)) return companyPlace(company, branches);
  return {
    key: `branch:${b.id}`, name: `${str(company.name)} ${b.name}`.trim(), koyoNumber: str(b.koyo_office_number),
    helloWork: str(b.koyo_hello_work) || str(company.koyo_hello_work), prefecture: str(b.prefecture), zip: str(b.zip_code) || str(company.zip_code),
    address: str(b.address) || str(company.address), phone: str(b.phone) || str(company.phone),
  };
};

/** 雇用保険適用事業所の一覧（会社と、別の適用事業所の拠点） */
export const koyoPlaces = (company: LaborCompany, branches: LaborBranch[]): KoyoPlace[] => {
  const out = [companyPlace(company, branches)];
  for (const b of branches) {
    const p = koyoPlaceOf(company, branches, b.id);
    if (!out.some((x) => x.key === p.key)) out.push(p);
  }
  return out;
};

/** 届書のファイルの事業所情報（社会保険の事業所整理記号・事業所番号は会社のもの） */
export const koyoOfficeOf = (company: LaborCompany, place: KoyoPlace): KoyoOffice => ({
  symbol: company.shaho_office_symbol, number: company.shaho_office_number, prefecture: place.prefecture, zip: place.zip,
  address: place.address, name: place.name, owner: company.representative, phone: place.phone, koyoNumber: place.koyoNumber,
});

/** 労働保険の事業（年度更新の単位） */
export interface LaborUnit {
  /** "company" か "branch:2" */
  key: string;
  name: string;
  laborNumber: string;
  /** 労災保険率表の事業の種類の番号と、表と違う率（メリット制など） */
  rousaiBusiness: string;
  rousaiRate: number | null;
  /** この事業に入る拠点 */
  branchIds: number[];
}

/** 労働保険の事業の一覧（会社と、別の労働保険番号の拠点） */
export const laborUnits = (company: LaborCompany, branches: LaborBranch[]): LaborUnit[] => {
  const head: LaborUnit = {
    key: "company", name: str(company.name), laborNumber: str(company.labor_ins_num), rousaiBusiness: str(company.rousai_business),
    rousaiRate: company.rousai_rate === null || company.rousai_rate === undefined || company.rousai_rate === ("" as unknown) ? null : Number(company.rousai_rate),
    branchIds: [],
  };
  const units: LaborUnit[] = [head];
  for (const b of branches) {
    if (b.id !== 1 && str(b.labor_ins_num) && !same(b.labor_ins_num, company.labor_ins_num)) {
      units.push({
        key: `branch:${b.id}`, name: `${str(company.name)} ${b.name}`.trim(), laborNumber: str(b.labor_ins_num),
        rousaiBusiness: str(b.rousai_business) || head.rousaiBusiness,
        rousaiRate: b.rousai_rate === null || b.rousai_rate === undefined ? (str(b.rousai_business) ? null : head.rousaiRate) : Number(b.rousai_rate),
        branchIds: [b.id],
      });
    } else {
      head.branchIds.push(b.id);
    }
  }
  if (head.branchIds.length === 0) head.branchIds.push(1);
  return units;
};

/** 雇用保険適用事業所番号の形が正しいか */
export const validKoyoNumber = (value: string | null | undefined): boolean => !!splitKoyoNumber(value);
