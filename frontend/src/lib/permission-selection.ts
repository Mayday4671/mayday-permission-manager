/** 操作授权的依赖关系与旧授权规则一致；集中在此供单选、模块全选共用。 */
export function permissionDependencies(key: string): string[] {
  const [resource, action] = key.split(":");
  return [
    ...new Set([
      key,
      `${resource}:view`,
      ...(resource === "userstats" ? ["users:view"] : []),
      ...(action.endsWith("-write")
        ? [`${resource}:${action.replace("-write", "-read")}`]
        : []),
    ]),
  ];
}

/**
 * 添加操作时补齐查看/字段读取；撤销父权限时一起撤销依赖操作。
 * 模块筛选只是显示行为，未显示的其他权限始终留在集合中。
 * 权限授予还由服务端校验；此处防止 UI 的模块全选越过当前操作者自身授权范围。
 */
export function changePermission(
  value: string[],
  key: string,
  checked: boolean,
  can: (key: string) => boolean,
): string[] {
  if (!can(key)) return value;
  const next = new Set(value);
  if (checked) {
    const dependencies = permissionDependencies(key);
    if (!dependencies.every(can)) return value;
    dependencies.forEach((dependency) => next.add(dependency));
  } else {
    // 反向依赖同样用于 users:view -> userstats:view，避免残留无法使用的授权。
    for (const selected of next) {
      if (permissionDependencies(selected).includes(key)) next.delete(selected);
    }
  }
  return [...next];
}
