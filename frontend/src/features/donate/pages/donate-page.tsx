import { Page, PageHeader } from '../../../components/layout/page';
import { buttonVariants } from '../../../components/ui/button-variants';

export default function DonatePage() {
  return (
    <Page width="narrow" className="pb-24">
      <PageHeader
        title="Support HLBuilder"
        lede="Love HLBuilder? Consider supporting its development - every bit helps keep the project alive and growing."
      />

      {/* The author's own words. */}
      <div className="max-w-[42rem] space-y-5 pt-8 text-[0.9375rem] leading-7">
        <p>
          Hi, I'm <strong>Miłosz</strong> (Butters/Butterski online). I study and work in IT here in
          Poland, and I pour my evenings and weekends into coding, AI, and homelabbing - because
          that's what I genuinely love.
        </p>
        <p>
          <strong>HLBuilder started as a passion project</strong> - a tool I built because I
          couldn't find anything that fit the way homelabbers actually think. It's grown far beyond
          what I ever expected, thanks to you.
        </p>
        <p>
          Running this beta costs money - servers don't pay for themselves.
          <strong> Donations go directly toward:</strong>
        </p>

        <ul className="list-disc space-y-1 pl-6">
          <li>Keeping the beta online and responsive</li>
          <li>Upgrading to a dedicated server for the 1.0 release</li>
          <li>AI tools that help me develop features faster</li>
          <li>And yes - maybe a network card that doesn't crash mid-Overwatch 😅</li>
        </ul>

        <p>
          <em>Full transparency:</em> This project is about <strong>70% "vibecoded" with AI</strong>{' '}
          and 30% good old-fashioned debugging. Those AI subscriptions add up - but they let me move
          fast and build things that would otherwise take months.
        </p>

        <div className="space-y-2 border-y py-5">
          <p className="font-semibold">
            Here's my promise: HLBuilder will stay free and open to everyone, no paywalls or
            exclusive features. Your support just helps me keep the lights on and the updates
            coming.
          </p>
          <p className="text-sm text-muted-foreground">
            I'm also available for consulting or custom implementations - if your team or business
            needs HLBuilder internally, reach out!
          </p>
        </div>

        <p>
          On a personal note: I'm currently renovating my house (a homelab of a different kind!). If
          you'd like to help a dev build both digital and physical infrastructure - every coffee
          counts. ❤️
        </p>
      </div>

      <div className="mt-8 grid max-w-[42rem] gap-px border-y">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-medium">Buy me a coffee</p>
            <p className="text-sm text-muted-foreground">One-time or monthly</p>
          </div>
          <a
            href="https://buymeacoffee.com/butterski"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants()}
          >
            Open Buy Me a Coffee
          </a>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t py-4">
          <div>
            <p className="font-medium">GitHub Sponsor</p>
            <p className="text-sm text-muted-foreground">Support development</p>
          </div>
          <a
            href="https://github.com/sponsors/Butterski"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline' })}
          >
            Open GitHub Sponsors
          </a>
        </div>
      </div>
    </Page>
  );
}
