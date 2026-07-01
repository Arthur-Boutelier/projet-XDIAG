export async function cropImage(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("http://127.0.0.1:8000/crop", {
        method: "POST",
        body: formData
    });

    return await response.blob();
}


export async function sendImage(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("http://127.0.0.1:8000/predict", {
        method: "POST",
        body: formData,
    });

    return await response.json();
}
