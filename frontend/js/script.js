import { cropImage, sendImage } from "./api.js";


// Gérer le titre de la page en fonction de la taille
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


// Drag&Drop
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const preview = document.getElementById("preview");

dropZone.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];

    if (!file) return;

    const blob = await cropImage(file);
    const url = URL.createObjectURL(blob);

    preview.src = url;
    preview.style.display = "block";

    const data = await sendImage(file);
    console.log(data);
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

    const file = e.dataTransfer.files[0];
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


// Ignorer le champs AP/PA en cas de radio latérale
const frontale = document.getElementById("frontale");
const laterale = document.getElementById("laterale");

const ap = document.getElementById("ap");
const pa = document.getElementById("pa");
const directionRadios = [ap, pa];

function updateDirectionState() {
    if (laterale.checked) {
        directionRadios.forEach(r => {
            r.checked = false;
            r.disabled = true;
        });
    } else {
        directionRadios.forEach(r => {
            r.disabled = false;
        });
    }
}

frontale.addEventListener("change", updateDirectionState);
laterale.addEventListener("change", updateDirectionState);


// Reset du form
const resetButton = document.getElementById("reset");
resetButton.addEventListener("click", () => {
    document.getElementById("age").value = "";
    document.getElementById("sex").selectedIndex = 0;

    frontale.checked = false;
    laterale.checked = false;

    ap.checked = false;
    pa.checked = false;
})