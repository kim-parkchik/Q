export const fetchAddressByZip = async (zip: string) => {
    const cleanZip = zip.replace(/[^\d]/g, "");
    if (cleanZip.length !== 7) return null;
    
    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleanZip}`);
    const data = await response.json();
    return data.results ? data.results[0] : null;
};