import {
  MeetingView,
  MeetingViewError,
  MeetingViewLoading,
} from "@/modules/meeting/ui/views/meetings-views";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Suspense } from "react";
import { MeetingsListHeader } from "@/modules/meeting/ui/components/meetings-list-header";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const page = async () => {
  const session = await auth.api.getSession({
      headers: await headers(),
    });
  
    if (!session) {
      redirect("/sign-in");
    }


  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.meetings.getMany.queryOptions({}));

  return (
    <>
      <MeetingsListHeader/>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<MeetingViewLoading />}>
          <ErrorBoundary fallback={<MeetingViewError />}>
            <MeetingView />
          </ErrorBoundary>
        </Suspense>
      </HydrationBoundary>
    </>
  );
};

export default page;
