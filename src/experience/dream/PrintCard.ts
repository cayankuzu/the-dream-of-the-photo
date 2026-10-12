import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type Texture } from 'three';
import { photoConfig } from '../../config/experience.config';

const { print, image } = photoConfig;
/** Vertical center of the image area relative to the print's center. */
const IMAGE_CENTER_Y = print.height / 2 - image.offsetFromTop - image.size / 2;

const paperGeometry = new BoxGeometry(print.width, print.height, print.thickness);
const imageGeometry = new PlaneGeometry(image.size, image.size);
const front = new MeshStandardMaterial({ color: 0xe9e5dc, roughness: 0.68 });
const edge = new MeshStandardMaterial({ color: 0xdcd7cc, roughness: 0.85 });
const back = new MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.75 });
const paperMaterials = [edge, edge, edge, edge, front, back];
const pictures = new Map<Texture, MeshBasicMaterial>();
/** The picture lies a fraction of a millimeter over the paper: pulled toward the eye so the two never fight far away. */
const PICTURE_OFFSET = { factor: -1, units: -2 };

/**
 * A plain physical print for the dream's many photographs (on the lines, over the sea). The paper
 * is lit like everything else; the picture is not: it shows the light it recorded.
 * @param anchor which point of the print sits at the group's origin (its top edge, for pegged prints)
 */
export function printCard(photo: Texture, scale: number, anchor: 'top' | 'center' = 'center'): Group {
  let picture = pictures.get(photo);
  if (!picture) {
    picture = new MeshBasicMaterial({
      map: photo,
      polygonOffset: true,
      polygonOffsetFactor: PICTURE_OFFSET.factor,
      polygonOffsetUnits: PICTURE_OFFSET.units,
    });
    pictures.set(photo, picture);
  }
  const card = new Group();
  card.name = 'PrintCard';
  const offsetY = anchor === 'top' ? -print.height / 2 : 0;
  const paper = new Mesh(paperGeometry, paperMaterials);
  paper.position.y = offsetY;
  paper.castShadow = true;
  paper.receiveShadow = true;
  const img = new Mesh(imageGeometry, picture);
  img.position.set(0, offsetY + IMAGE_CENTER_Y, print.thickness / 2 + 0.00006);
  card.add(paper, img);
  card.scale.setScalar(scale);
  return card;
}
