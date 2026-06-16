export function Header({ onNewChat }: { onNewChat: () => void }) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">V</div>
        <span className="header-title">Vinart</span>
      </div>
      <div className="header-actions">
        <button className="btn btn-sm btn-ghost" onClick={onNewChat}>
          + 新建对话
        </button>
      </div>
    </header>
  );
}
