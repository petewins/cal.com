import { IS_TEAM_BILLING_ENABLED } from "@calcom/lib/constants";
import { closeComUpsertTeamUser } from "@calcom/lib/sync/SyncServiceManager";
import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../trpc";
import type { TCreateInputSchema } from "./create.schema";

type CreateOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TCreateInputSchema;
};

export const createHandler = async ({ ctx, input }: CreateOptions) => {
  const { user } = ctx;
  const { slug, name, logo } = input;
  const isOrgChildTeam = !!user.organizationId;
  let org;

  // For orgs we want to create teams under the org
  if (user.organizationId) {
    org = await prisma.team.findFirst({
      where: {
        id: user.organizationId,
      },
      select: {
        members: true,
      },
    });

    if (!org) throw new TRPCError({ code: "NOT_FOUND" });

    // Check if the user has permission to create a team under the org
    if (
      !org?.members.some(
        (member) =>
          (member.userId === user.id && member.role === MembershipRole.OWNER) ||
          member.role === MembershipRole.ADMIN
      )
    ) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
  }

  const slugCollisions = await prisma.team.findFirst({
    where: {
      slug: slug,
      // If this is under an org, check that the team doesn't already exist
      ...(isOrgChildTeam && { parentId: user.organizationId }),
    },
  });

  if (slugCollisions) throw new TRPCError({ code: "BAD_REQUEST", message: "team_url_taken" });

  // Ensure that the user is not duplicating a requested team
  const duplicatedRequest = await prisma.team.findFirst({
    where: {
      members: {
        some: {
          userId: ctx.user.id,
        },
      },
      metadata: {
        path: ["requestedSlug"],
        equals: slug,
      },
    },
  });

  if (duplicatedRequest) {
    return duplicatedRequest;
  }

  const createTeam = await prisma.team.create({
    data: {
      name,
      logo,
      members: {
        create: {
          userId: ctx.user.id,
          role: MembershipRole.OWNER,
          accepted: true,
        },
      },
      metadata: {
        requestedSlug: slug,
      },
      ...(isOrgChildTeam && { parentId: user.organizationId }),
      ...(!IS_TEAM_BILLING_ENABLED && { slug }),
    },
  });

  // Sync Services: Close.com
  closeComUpsertTeamUser(createTeam, ctx.user, MembershipRole.OWNER);

  return createTeam;
};
