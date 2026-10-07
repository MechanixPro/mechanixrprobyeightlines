// The operating company, printed in email footers. Keep in step with src/company.json (a test checks this).
export const COMPANY = {
  legalName: "NOVA VENTURES", brand: "Mechanix Pro",
  addressLines: ["Haralur Main Rd", "1st Sector, HSR Layout"], city: "Bengaluru", state: "Karnataka", pincode: "560102",
  gstin: "29DVCPR0895G1Z3",
};
export const companyLine = (): string => `${COMPANY.brand} is a brand of ${COMPANY.legalName}, ${COMPANY.addressLines.join(', ')}, ${COMPANY.city} ${COMPANY.pincode}`;
