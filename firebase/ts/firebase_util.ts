
export function generateRandomString(length : number) {
    // Define the possible characters
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;

    // Create a Uint8Array to hold random values
    const array = new Uint8Array(length);

    // Fill the array with cryptographically secure random values
    window.crypto.getRandomValues(array);

    // Convert the random values to characters
    let randomString = '';
    for (let i = 0; i < length; i++) {
        randomString += characters.charAt(array[i] % charactersLength);
    }

    return randomString;
}

export function dateString() : string {
    // Create a new Date object representing the current date and time
    const currentDate = new Date();

    // Add 9 hours to the current date and time
    currentDate.setHours(currentDate.getHours() + 9);

    const s = currentDate.toISOString().replace("T", "-").replaceAll(":", "-");
    const k = s.indexOf(".");

    return s.substring(0, k);
}
