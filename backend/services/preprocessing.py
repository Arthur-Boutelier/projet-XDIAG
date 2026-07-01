import copy
import numpy as np
import pandas as pd

SIZE = 320


def numeric_df(df):
    new_df = copy.deepcopy(df)

    sexes = {"Male": 0, "Female": 1}
    new_df["Sex"] = new_df["Sex"].map(sexes)

    axes = {"Frontal": 0, "Lateral": 1}
    new_df["Frontal/Lateral"] = new_df["Frontal/Lateral"].map(axes)

    ap_pa_dict = {"AP": 0, "PA": 1}
    new_df["AP/PA"] = new_df["AP/PA"].map(ap_pa_dict)

    return new_df


def crop_img(image):
    img_w, img_h = image.size

    left = 0 + (img_w - SIZE) // 2
    top = 0 + (img_h - SIZE) // 2
    right = left + SIZE
    bottom = top + SIZE

    img_cropped = image.crop((left, top, right, bottom))
    return img_cropped


def preprocessing(image):
    x = np.array(image, dtype=np.float32)

    # Normaliser (entre 0 et 1)
    x /= 255.0

    # Standardiser (centré réduit)
    x = (x - x.mean()) / x.std()

    # Ajouter la dimension de l'image (grayscale -> 1)
    x = np.expand_dims(x, axis=0)       # (1, 320, 320)

    return x