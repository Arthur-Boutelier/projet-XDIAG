function updateHeaderTitle(){
    const title = document.getElementById("title");

    if (window.innerWidth <  490){
        title.textContent = "ARVI-RX";
    } else {
        title.textContent = "Assistant Radiologue Virtuel";
    }
}

updateHeaderTitle();
window.addEventListener("resize", updateHeaderTitle);

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const preview = document.getElementById("preview");

dropZone.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    showImage(file);
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", (e) => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");

    const file = e.target.files[0];
    showImage(file);
});

function showImage(file) {
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();

    reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = "block";
    }

    reader.readAsDataURL(file);
}