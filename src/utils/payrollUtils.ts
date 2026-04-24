// 端数処理ヘルパー
export const applyRounding = (value: number, type: string) => {
    switch (type) {
        case 'currency_law': // 法的原則：50銭以下切り捨て、50銭超（0.51円以上）切り上げ
            // 0.5ちょうどまでは切り捨て、それを超えたら切り上げるロジック
            return (value - Math.floor(value) > 0.5) ? Math.ceil(value) : Math.floor(value);
            
        case 'floor': return Math.floor(value); // 切り捨て
        case 'ceil':  return Math.ceil(value);  // 切り上げ
        case 'round': return Math.round(value); // 四捨五入（0.5以上切り上げ）
        
        default:      return Math.floor(value);
    }
};