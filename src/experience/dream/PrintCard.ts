import { BoxGeometry, MeshStandardMaterial, PlaneGeometry } from 'three';
import { photoConfig } from '../../config/experience.config';

const { print, image } = photoConfig;

/** Vertical center of the image area relative to the print's center. */
export const IMAGE_CENTER_Y = print.height / 2 - image.offsetFromTop - image.size / 2;
/** How far a picture lies over the paper (m at a real print's size). */
export const PICTURE_LIFT = 0.00006;

/** A plain physical print for the dream's many photographs: the paper is lit like everything else. */
export const paperGeometry = new BoxGeometry(print.width, print.height, print.thickness);
export const imageGeometry = new PlaneGeometry(image.size, image.size);

const front = new MeshStandardMaterial({ color: 0xe9e5dc, roughness: 0.68 });
const edge = new MeshStandardMaterial({ color: 0xdcd7cc, roughness: 0.85 });
const back = new MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.75 });
export const paperMaterials = [edge, edge, edge, edge, front, back];
