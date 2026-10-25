const fieldClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function LoginForm({ failed = false, limited = false }: { failed?: boolean; limited?: boolean }) {
  return (
    <form className="flex flex-col gap-3" method="post" action="/api/v1/admin/login">
      {limited ? <p className="text-sm text-destructive">尝试太频繁，请稍后再登</p> : null}
      {failed && !limited ? <p className="text-sm text-destructive">账号或密码不正确</p> : null}
      <label className="flex flex-col gap-1 text-sm">
        账号
        <input
          className={fieldClass}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        密码
        <input
          className={fieldClass}
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </label>
      <button
        type="submit"
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground"
      >
        登录
      </button>
    </form>
  );
}
