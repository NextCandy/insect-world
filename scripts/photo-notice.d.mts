export interface NoticePhoto {
  photoId: number
  photographer: string
  license: string
  inatUrl: string
}
export function renderPhotoNotice(photos: Record<string, NoticePhoto>): string
export function writePhotoNotice(photos: Record<string, NoticePhoto>, root: string): void
export function checkPhotoNotice(root: string): boolean
