export function parseProjectId(value : string | null, fallback? : number) : number | null {

    if(value == null){
        if (fallback) {
            return fallback
        }
        return null;
    }

    if (!/^\d+$/.test(value)) {
        return null;
    }

    // Meaning:
    // ^ → start of string
    // \d → a digit (0-9)
    // + → one or more digits
    // $ → end of string

    const numId = Number(value);

    if (Number.isSafeInteger(numId)) {
        return numId
    }
    else return null;
}