export type AppInfo = {
  version: string;
  updatedAt: string;
  dateKind: string;
  location: string;
};

export default function BuildInfo({ info }: { info: AppInfo }) {
  return <p className="build-info" title="Data w strefie Europe/Warsaw. Na Vercel pochodzi z commita, a bez historii Git — z builda.">
    v{info.version} <span>·</span> {info.dateKind}: {info.updatedAt} <span>·</span> {info.location}
  </p>;
}
