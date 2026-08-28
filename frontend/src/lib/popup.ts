const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

const openedWins: Record<string, { win: Window; url: string }> = {}

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
    return
  }
  // 이미 같은 URL로 열려있으면 새로고침하지 않고 앞으로만 가져옴 (사용자가 닫기 전까지 유지)
  const prev = openedWins[name]
  if (prev && !prev.win.closed && prev.url === url) {
    prev.win.focus()
    return
  }
  const win = window.open(url, name, features || 'width=700,height=700,left=100,top=50')
  if (win) openedWins[name] = { win, url }
}

// 웨이크워드 등 외부에서 통벗 채팅창 열기/앞으로 가져오기
export function openTongbotChat() {
  openPopup('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50')
}
