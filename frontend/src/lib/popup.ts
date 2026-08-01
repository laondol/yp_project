const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export function openPage(url: string, name?: string) {
  if (isMobile()) {
    window.location.href = url
  } else {
    window.open(url, name, 'width=700,height=700,left=100,top=50')
  }
}

export function openPopup(url: string, name: string, features?: string) {
  if (isMobile()) {
    window.location.href = url
  } else {
    window.open(url, name, features || 'width=700,height=700,left=100,top=50')
  }
}
